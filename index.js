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
        "night"
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
                    handled = true;
                    send(events.on, true);
                    if (events.off.type == '3') schedule(events.off, null, true); // If 'off' is of type duration, schedule 'off' event.
                    status(events.on, true);
                } else if (msg.payload === 'off') {
                    // Sends the off event, then re-schedules it
                    handled = true;
                    send(events.off);
                    schedule(events.off);
                    status(events.off, true);
                } else if (msg.payload === 'trigger') {
                    handled = true;
                    send(events.on);
                } else if (msg.payload === 'info') {
                    handled = true;
                    node.send({
                        topic: 'info',
                        payload: {
                            name: function() {
                                return node.name || 'eztimer';
                            }(),
                            on: function() {
                                if (isSuspended()) return 'suspended';
                                if (events.on.type == '9') return 'manual';
                                if (!events.on.moment) return 'error';
                                return events.on.moment.toDate().toString()
                            }(),
                            off: function() {
                                if (config.timerType == '2') return undefined; // Trigger
                                if (isSuspended()) return 'suspended';
                                if (!events.off.moment) return 'manual';
                                return events.off.moment.toDate().toString()
                            }(),
                            state: function() {
                                if (config.timerType == '2') return undefined; // Trigger
                                if (isSuspended()) return 'suspended';
                                if (state) { return 'on' } else { return 'off' }
                            }(),
                            ontopic: events.on.topic,
                            onpayload: events.on.payload,
                            offtopic: events.off.topic,
                            offpayload: events.off.payload
                        }
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
                            requiresBootstrap = requiresBootstrap || previous !== obj[prop];
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
                        requiresBootstrap = requiresBootstrap || previous !== obj[prop];
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
            event.callback = function() {
                // Send the event
                send(event);
                // Schedule the next event, if it's not a 'manual' timer
                if (events.on.type != '9') schedule(event, null, null);
                // Clear the event if it IS a 'manual' timer (as we don't know when the off event will be)
                if (events.on.type == '9') event.moment = undefined;
                // Update the status/icon
                status(event);
            };
            return event;
        }

        function send(event, manual) {
            //node.warn('sending \'' + event.name + '\'');
            var msg = {};
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
                } else {
                    currPart[spl[i]] = event.value;
                }
              }
            }
            node.send(msg);
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
                        if (!init) event.moment = event.moment.add(1, 'days');
                    } else {
                        event.moment = null;
                    }

                    //node.warn('event \'' + event.name + '\' scheduled for ' + event.moment.format('DD/MM HH:mm:ss.SSS') + ' raw');
                    break;
                case '3': //Duration
                    var matches = new RegExp(/(\d+):(\d+):(\d+)/).exec(event.duration);
                    var secs = (matches[3] * 1) + (matches[2] * 60) + (matches[1] * 3600);
                    if (manual) {
                        //event is manual - schedule assuming 'now'
                        event.moment = moment(node.now()).add(secs, 'seconds');
                    } else {
                        event.moment = moment(event.inverse.moment).add(secs, 'seconds');
                        //node.warn('event \'' + event.name + '\' scheduled for ' + event.moment.format('DD/MM HH:mm:ss.SSS') + ' raw');
                    }

                    // See if we can roll back a day - the on-time has passed, but the off-time might not have.
                    if (init && moment(event.moment).add(-1, 'days').isAfter(now)) {
                        event.moment.add(-1, 'day');
                        //node.warn('event \'' + event.name + '\' scheduled for ' + event.moment.format('DD/MM HH:mm:ss.SSS') + ' rollback');
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
            //if (!isInitial || (isInitial && now.isAfter(event.moment))) {
            if (now.isAfter(event.moment)) {
                //node.warn('event \'' + event.name + '\' - \'' + now.format('DD/MM HH:mm:ss.SSS') + '\' is after \'' + event.moment.format('DD/MM HH:mm:ss.SSS') + '\', adding a day.');
                event.moment.add(1, 'day');
                //node.warn('event \'' + event.name + '\' scheduled for ' + event.moment.format('DD/MM HH:mm:ss.SSS') + ' past');
            }

            // Adjust weekday if not selected
            while (!weekdays()[event.moment.isoWeekday() - 1]) {
                event.moment.add(1, 'day');
                //node.warn('event \'' + event.name + '\' scheduled for ' + event.moment.format('DD/MM HH:mm:ss.SSS') + ' skip');
            }

            if (event.timeout) {
                clearTimeout(event.timeout);
            }

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
                    data.text = event.name + (manual ? ' manual' : ' auto') + (isSuspended() ? ' - scheduling suspended' : ` until ${event.inverse.moment.format(fmt)}`);
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
