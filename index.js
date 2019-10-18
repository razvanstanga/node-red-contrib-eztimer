const util = require('util');

/* eslint-disable no-invalid-this,consistent-this */
/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 @biddster
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
'use strict';
module.exports = function(RED) {
    const debug = true;
    const moment = require('moment');
    const SunCalc = require('suncalc');
    const _ = require('lodash');
    const fmt = 'YYYY-MM-DD HH:mm:ss';
    const sunTimes = [
        "solarNoon",
        "goldenHourEnd",
        "goldenHour",
        "sunriseEnd",
        "sunsetStart",
        "sunrise",
        "sunset",
        "dawn",
        "dusk",
        "nauticalDawn",
        "nauticalDusk",
        "nightEnd",
        "night",
        "nadir"
    ];

    RED.nodes.registerType('eztimer', function(config) {
        RED.nodes.createNode(this, config);
        const node = this
        var events = {};
        var state = false;

        switch (config.timerType) {
            case '1':
                events.on = setupEvent('on', 'dot');
                events.off = setupEvent('off', 'ring');
                break;
            case '2':
                events.on = setupEvent('on', 'ring');
                events.off = null;
                break;
        }

        if (events.on && events.off) {
            events.on.inverse = events.off;
            events.off.inverse = events.on;
        }

        function weekdays() {
            return [
                config.mon,
                config.tue,
                config.wed,
                config.thu,
                config.fri,
                config.sat,
                config.sun
            ];
        }

        node.on('input', function(msg) {
            let handled = false,
            requiresBootstrap = false;
            if (_.isString(msg.payload)) {
                if (msg.payload === 'on') {
                    // Sends the on event without impacting the scheduled event
                    handled = true;
                    send(events.on, true);
                    if (events.off.type == '3') schedule(events.off, null, true); // If 'off' is of type duration, schedule 'off' event.
                    status(events.on, true);
                } else if (msg.payload === 'off') {
                    // Sends the off event, then re-schedules it
                    handled = true;
                    send(events.off, true);
                    if (!isSuspended()) schedule(events.off);
                    status(events.off, true);
                } else if (msg.payload === 'trigger') {
                    // Sends the trigger/on event without impact the scheduled event
                    handled = true;
                    send(events.on);
                } else if (msg.payload === 'cancel' && config.timerType == '1') {
                    // Cancels the current timer without sending the off event
                    handled = true;
                    if (!isSuspended()) {
                        schedule(events.on);
                        schedule(events.off);
                    }
                    status(events.off);
                } else if (msg.payload === 'info') {
                    handled = true;
                    var ret = {
                        name: node.name || 'eztimer',
                        state: function() {
                            if (config.timerType == '2') return undefined; // Trigger
                            if (isSuspended()) return 'suspended';
                            if (state) { return 'on' } else { return 'off' }
                        }()
                    };
                    if (config.timerType == '1') {
                        // on/off timer
                        ret.on = {
                            property: 'msg.' + events.on.property,
                            value: events.on.value || "<none>",
                            nextEvent: function() {
                                if (isSuspended()) return 'suspended';
                                if (events.on.type == '9') return 'manual';
                                if (!events.on.moment) return 'error';
                                return events.on.moment.toDate().toString()
                            }()
                        };
                        ret.off = {
                            property: 'msg.' + events.off.property,
                            value: events.off.value || "<none>",
                            nextEvent: function() {
                                if (config.timerType == '2') return undefined; // Trigger
                                if (isSuspended()) return 'suspended';
                                if (!events.off.moment) return 'manual';
                                return events.off.moment.toDate().toString()
                            }()
                        };
                    } else {
                        // trigger
                        ret.trigger = {
                            property: 'msg.' + events.on.property,
                            value: events.on.value || "<none>",
                            nextEvent: function() {
                                if (isSuspended()) return 'suspended';
                                if (events.on.type == '9') return 'manual';
                                if (!events.on.moment) return 'error';
                                return events.on.moment.toDate().toString()
                            }()
                        };
                    }
                    node.send({
                        topic: 'info',
                        tag: config.tag || 'eztimer',
                        payload: ret
                    });
                } else {
                    if (msg.payload.indexOf('suspended') !== -1) {
                        handled = true;
                        const match = /.*suspended\s+(\S+)/.exec(msg.payload);
                        const previous = config.suspended;
                        config.suspended = toBoolean(match[1]);
                        requiresBootstrap = requiresBootstrap || (previous !== config.suspended && config.sendEventsOnSuspend);
                    }
                    enumerateProgrammables(function(obj, prop, payloadName, typeConverter) {
                        const match = new RegExp(`.*${payloadName}\\s+(\\S+)`).exec(
                            msg.payload
                        );
                        if (match) {
                            handled = true;
                            const previous = obj[prop];
                            obj[prop] = typeConverter(match[1]);
                            requiresBootstrap = requiresBootstrap || (previous !== obj[prop] && dynamicDuration(prop, obj[prop]));
                        }
                    });
                }
            } else {
                if (msg.payload.hasOwnProperty('suspended')) {
                    handled = true;
                    const previous = config.suspended;
                    config.suspended = !!msg.payload.suspended;
                    requiresBootstrap = requiresBootstrap || previous !== config.suspended;
                }
                enumerateProgrammables(function(obj, prop, payloadName, typeConverter) {
                    if (msg.payload.hasOwnProperty(payloadName)) {
                        handled = true;
                        const previous = obj[prop];
                        obj[prop] = typeConverter(msg.payload[payloadName]);
                        requiresBootstrap = requiresBootstrap || (previous !== obj[prop] && dynamicDuration(prop, obj[prop]));
                    }
                });
            }
            if (!handled) {
                node.status({
                    fill: 'red',
                    shape: 'dot',
                    text: 'Unsupported input'
                });
            } else if (requiresBootstrap) {
                bootstrap();
            }
        });

        function dynamicDuration(property, duration) {
            // Return false if not a duration request
            if (property != "duration") return true;

            if (state) {
                // Timer currently 'on' - parse time
                var secs = getSeconds(duration);
                var offTime = moment(events.on.last.moment).add(secs, 'seconds');
                
                if (offTime.isBefore(node.now())) {
                    // New time is before now - need to turn off and schedule
                    node.log("Live duration change (" + duration + " => " + secs + "s) causes an off-time in the past, sending 'off' event.");
                    send(events.off);
                    schedule(events.off);
                    status(events.off);
                } else {
                    // New time is after now - just update the scheduled off event (and status)
                    node.log("Live duration change (" + duration + " => " + secs + "s), rescheduling 'off' time to " + offTime.toString());
                    schedule(events.off, null, true);
                    status(events.on);
                }
            } else {
                // Timer currently 'off', just re-schedule of off event (if an on event is scheduled)
                if (!isSuspended()) {
                    schedule(events.off);
                    status(events.off);
                }
            }
            // Return false to indicate no bootstrap required
            return false;
        }

        function getSeconds(val) {
            var secs = 0;

            // accept 00:00, 00:00:00, 45s, 45h,4m etc.
            var matches = new RegExp(/(?:(\d+)[h:\s,]+)?(?:(\d+)[m:\s,]+)?(?:(\d+)[s\s]*)?$/).exec(val);
            if (matches.length > 1) {
                if (matches[1] != null) {
                    secs += parseInt(matches[1]) * 3600; // hours
                }
                if (matches[2] != null) {
                    secs += parseInt(matches[2]) * 60; // minutes
                }
                if (matches[3] != null) {
                    secs += parseInt(matches[3]) * 1; // seconds
                }
            } else {
                return 0;
            }
            
            return secs;
        }

        node.on('close', suspend);

        function setupEvent(eventName, shape) {
            const filtered = _.pickBy(config, function(value, key) {
                return key && key.indexOf(eventName) === 0;
            });
            const event = _.mapKeys(filtered, function(value, key) {
                return key.substring(eventName.length).toLowerCase();
            });
            event.name = eventName.toUpperCase();
            event.shape = shape;
            event.state = (eventName == 'on');
            event.last = { moment: null };
            event.callback = function() {
                // Send the event
                send(event);
                if (events.on.type != '9' && !isSuspended()) {
                    // Schedule the next event, if it's not a 'manual' timer
                    schedule(event, null, null);
                } else {
                    // Else just clear the event - we don't know when the off event will be
                    event.moment = undefined;
                }
                // Update the status/icon
                status(event);
            };
            return event;
        }

        function send(event, manual) {
            //node.warn('sending \'' + event.name + '\'');
            var msg = {};
            msg.tag = config.tag || 'eztimer';
            var currPart = msg;
            var spl = event.property.split('.');
            for (var i in spl) {
              if (i < (spl.length - 1)) {
                if (!currPart[spl[i]]) currPart[spl[i]] = {};
                currPart = currPart[spl[i]];    
              } else {
                if (event.valuetype == 'json') {
                    currPart[spl[i]] = JSON.parse(event.value);
                } else if (event.valuetype == 'bool') {
                    currPart[spl[i]] = (event.value == "true");
                } else if (event.valuetype == 'date') {
                    currPart[spl[i]] = (new Date()).getTime();
                } else {
                    currPart[spl[i]] = event.value;
                }
              }
            }
            event.last.moment = node.now();
            if (!event.suppressrepeats || state != event.state) node.send(msg);
            state = event.state;
        }


        function schedule(event, init, manual) {
            var now = node.now();
            
            switch (event.type) {
                case '1': //Sun
                    var nextDate = new Date();
                    // Get tomorrow's sun data 
                    if (!init) nextDate = nextDate.setDate(nextDate.getDate() + 1);
                    const sunCalcTimes = SunCalc.getTimes(nextDate, config.lat, config.lon);
                    // Get first event - move closer to noon if required.
                    var t = sunTimes.indexOf(event.timesun);
                    while (!moment(sunCalcTimes[sunTimes[t]]).isValid()) t = Math.max(t - 2, 0);
                    // If we've had to move closer to noon, emit a warning
                    if (event.timesun != sunTimes[t]) {
                        node.warn({ "message": 'Sun event (' + event.timesun + ') invalid for chosen lat/long (due to polar proximity). Sun event \'' + sunTimes[t] + '\' has been chosen as the closest valid candidate.', "events": sunCalcTimes});
                    }
                    // Use determined event time
                    var date = sunCalcTimes[sunTimes[t]];
                    if (date && moment(date).isValid()) {
                        event.moment = moment(date);
                    } else {
                        event.error = 'Unable to determine time for \'' + event.timesun + '\'';
                    }
                    break;
                case '2': //Time of Day
                    var m = node.now().millisecond(0);
                    var re = new RegExp(/\d+/g);
                    var p1, p2, p3;
                    p1 = re.exec(event.timetod);
                    if (p1) p2 = re.exec(event.timetod);
                    if (p2) p3 = re.exec(event.timetod);
                
                    if (p3) {
                        m.hour(+p1[0]).minute(+p2[0]).second(+p3[0]);
                    } else if (p2) {
                        m.hour(+p1[0]).minute(+p2[0]).second(0);
                    } else {
                        m = null;
                    }
                    if (m) {
                        event.moment = m;
                        // If a standard run, add a day
                        if (!init && !m.isAfter(now)) event.moment = event.moment.add(1, 'days');
                    } else {
                        event.moment = null;
                    }

                    break;
                case '3': //Duration
                    var secs = getSeconds(event.duration);
                    
                    if (manual) {
                        //event is manual - schedule based on last 'on' event
                        event.moment = moment(event.inverse.last.moment).add(secs, 'seconds');
                    } else {
                        // event is auto - schedule based on current 'on' event
                        event.moment = moment(event.inverse.moment).add(secs, 'seconds');
                    }

                    // See if we can roll back a day - the on-time has passed, but the off-time might not have.
                    if (init && moment(event.moment).add(-1, 'days').isAfter(now)) {
                        event.moment.add(-1, 'day');
                    }
                    break;
            }

            if (!event.moment) {
                node.status({
                    fill: 'red',
                    shape: 'dot',
                    text: event.error ? event.error : `Invalid time: ${event.timetod}`
                });
                return false;
            }

            if (event.offset) {
                let adjustment = event.offset;
                if (event.randomoffset) {
                    adjustment = event.offset * Math.random();
                }
                event.moment.add(adjustment, 'minutes');
            }

            // Add a day if the moment is in the past
            if (now.isAfter(event.moment)) {
                event.moment.add(1, 'day');
            }

            // Adjust weekday if not selected (and not manual)
            while (!manual && !weekdays()[event.moment.isoWeekday() - 1]) {
                event.moment.add(1, 'day');
            }

            // Clear any pending event
            if (event.timeout) clearTimeout(event.timeout);

            //console.log('schedule: ' + event.name + ' => ' + event.moment.toString());
            const delay = event.moment.diff(now);
            event.timeout = setTimeout(event.callback, delay);
            return true;
        }

        function status(event, manual) {
            manual = manual || (events.on.type == 9)
            var data = {
                fill: manual ? 'blue' : 'green',
                shape: event.shape,
                text: {}
            }
            if (event.inverse) {
                if (event.inverse.moment && event.inverse.moment.isAfter(node.now())) {
                    //data.text = event.name + (manual ? ' manual' : ' auto') + (isSuspended() ? ' - scheduling suspended' : ` until ${event.inverse.moment.format(fmt)}`);
                    data.text = event.name + (manual ? ' manual' : ' auto') + ` until ${event.inverse.moment.format(fmt)}`;
                } else {
                    data.text = event.name + (manual ? ' manual' : ' auto') + (isSuspended() ? ' - scheduling suspended' : ``);
                }
            } else {
                data.text = `trigger @ ${event.moment.format(fmt)}`;
            }

            node.status(data);
        }

        function suspend() {
            if (events.off) {
                if (config.sendEventsOnSuspend) send(events.off);
                clearTimeout(events.off.timeout);
                events.off.moment = null;
            }

            clearTimeout(events.on.timeout);
            events.on.moment = null;
            
            node.status({
                fill: 'grey',
                shape: 'dot',
                text: `Scheduling suspended ${
                    weekdays().indexOf(true) === -1 ? '(no weekdays selected) ' : ''
                }`
            });
        }

        function resume() {
            if (events.on.type == '9') return; // Don't do anything when resuming a manual timer
            if (schedule(events.on, true) && (!events.off || (events.off && schedule(events.off, true)))) {
                const firstEvent = events.off && events.off.moment.isBefore(events.on.moment) ? events.off : events.on;
                var message;
                if (events.off && events.off.moment) {
                    message = {
                        fill: 'yellow',
                        shape: 'dot',
                        text: `${firstEvent.name} @ ${firstEvent.moment.format(fmt)}, ${firstEvent.inverse.name} @ ${firstEvent.inverse.moment.format(fmt)}`
                    }
                } else {
                    message = {
                        fill: 'green',
                        shape: 'ring',
                        text: `trigger @ ${firstEvent.moment.format(fmt)}`
                    }
                }
                node.status(message);
            }
        }

        function bootstrap() {
            if (isSuspended()) {
                suspend();
            } else {
                resume();
                // Wait 2.5 for startup, then fire PREVIOUS event to ensure we're in the right state.
                setTimeout(function() {
                    if (config.startupMessage && config.startupMessage == true && events.on && events.on.moment && events.off && events.off.moment) {
                        if (events.off.moment.isAfter(events.on.moment)) {
                            //Next event is ON, send OFF
                            send(events.off);
                        } else {
                            //Next event is OFF, send ON
                            send(events.on);
                        }
                    } else if (config.startupMessage && config.startupMessage == true && events.on && !events.off) {
                        //Trigger
                        send(events.on);
                    }
                }, 2500);
            }
        }

        function isSuspended() {
            return config.suspended || weekdays().indexOf(true) === -1;
        }

        function enumerateProgrammables(callback) {
            callback(events.on, 'timetod', 'triggertime', String);
            callback(events.on, 'timetod', 'ontime', String);
            callback(events.on, 'topic', 'ontopic', String);
            callback(events.on, 'value', 'triggervalue', String);
            callback(events.on, 'value', 'onvalue', String);
            callback(events.on, 'offset', 'onoffset', Number);
            callback(events.on, 'randomoffset', 'onrandomoffset', toBoolean);
            callback(events.off, 'timetod', 'offtime', String);
            callback(events.off, 'duration', 'duration', String);
            callback(events.off, 'topic', 'offtopic', String);
            callback(events.off, 'value', 'offvalue', String);
            callback(events.off, 'offset', 'offoffset', Number);
            callback(events.off, 'randomoffset', 'offrandomoffset', toBoolean);
            callback(config, 'mon', 'mon', toBoolean);
            callback(config, 'tue', 'tue', toBoolean);
            callback(config, 'wed', 'wed', toBoolean);
            callback(config, 'thu', 'thu', toBoolean);
            callback(config, 'fri', 'fri', toBoolean);
            callback(config, 'sat', 'sat', toBoolean);
            callback(config, 'sun', 'sun', toBoolean);
            callback(config, 'lon', 'lon', Number);
            callback(config, 'lat', 'lat', Number);
        }

        function toBoolean(val) {
            // eslint-disable-next-line prefer-template
            return (val + '').toLowerCase() === 'true';
        }

        // Bodges to allow testing
        node.eztimerEvents = () => events;
        node.eztimerConfig = () => config;
        node.now = moment;

        bootstrap();
    });
};
