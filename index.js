/**
 The MIT License (MIT)

 Copyright (c) 2016 @biddster

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

module.exports = function(RED) {
    'use strict';

    var moment = require('moment');
    var SunCalc = require('suncalc');
    var _ = require('lodash');
    var fmt = 'YYYY-MM-DD HH:mm';

    RED.nodes.registerType('schedex', function(config) {
        RED.nodes.createNode(this, config);
        var node = this,
            events = {
                on: setupEvent('on', 'dot'),
                off: setupEvent('off', 'ring')
            };
        events.on.inverse = events.off;
        events.off.inverse = events.on;

        // migration code : if new values are undefined, set all to true
        if (
            config.sun === undefined &&
            config.mon === undefined &&
            config.tue === undefined &&
            config.wed === undefined &&
            config.thu === undefined &&
            config.fri === undefined &&
            config.sat === undefined
        ) {
            const name = config.name || config.ontime + ' - ' + config.offtime;
            node.warn(
                'Schedex [' +
                    name +
                    ']: New weekday configuration attributes are not defined, please edit the node. Defaulting to true.'
            );
            config.sun = config.mon = config.tue = config.wed = config.thu = config.fri = config.sat = true;
        }

        var weekdays = [config.mon, config.tue, config.wed, config.thu, config.fri, config.sat, config.sun];

        node.on('input', function(msg) {
            var handled = false,
                requiresBootstrap = false;
            if (_.isString(msg.payload)) {
                // TODO - with these payload options, we can't support on and ontime etc.
                if (msg.payload === 'on') {
                    handled = true;
                    send(events.on, true);
                } else if (msg.payload === 'off') {
                    handled = true;
                    send(events.off, true);
                } else if (msg.payload === 'info') {
                    handled = true;
                    node.send({
                        topic: 'info',
                        payload: {
                            on: isSuspended() ? 'suspended' : events.on.moment.toDate().toUTCString(),
                            off: isSuspended() ? 'suspended' : events.off.moment.toDate().toUTCString(),
                            state: isSuspended()
                                ? 'suspended'
                                : events.off.moment.isAfter(events.on.moment) ? 'off' : 'on'
                        }
                    });
                } else {
                    if (msg.payload.indexOf('suspended') !== -1) {
                        handled = true;
                        var match = /.*suspended\s+(\S+)/.exec(msg.payload);
                        var previous = config.suspended;
                        config.suspended = toBoolean(match[1]);
                        requiresBootstrap = requiresBootstrap || previous !== config.suspended;
                    }
                    enumerateOnOffEvents(function(eventType, eventName, eventNameTypeConverter) {
                        var prop = eventType + eventName;
                        var match = new RegExp('.*' + prop + '\\s+(\\S+)').exec(msg.payload);
                        if (match) {
                            handled = true;
                            var previous = events[eventType][eventName];
                            events[eventType][eventName] = eventNameTypeConverter(match[1]);
                            requiresBootstrap = requiresBootstrap || previous !== events[eventType][eventName];
                        }
                    });
                }
            } else {
                if (msg.payload.hasOwnProperty('suspended')) {
                    handled = true;
                    var previous = config.suspended;
                    config.suspended = !!msg.payload.suspended;
                    requiresBootstrap = requiresBootstrap || previous !== config.suspended;
                }
                enumerateOnOffEvents(function(eventType, eventName, eventNameTypeConverter) {
                    var prop = eventType + eventName;
                    if (msg.payload.hasOwnProperty(prop)) {
                        handled = true;
                        var previous = events[eventType][eventName];
                        events[eventType][eventName] = eventNameTypeConverter(msg.payload[prop]);
                        requiresBootstrap = requiresBootstrap || previous !== events[eventType][eventName];
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
            var filtered = _.pickBy(config, function(value, key) {
                return key && key.indexOf(eventName) === 0;
            });
            var event = _.mapKeys(filtered, function(value, key) {
                return key.substring(eventName.length).toLowerCase();
            });
            event.name = eventName.toUpperCase();
            event.shape = shape;
            event.callback = function() {
                send(event);
                schedule(event);
            };
            return event;
        }

        function send(event, manual) {
            node.send({
                topic: event.topic,
                payload: event.payload
            });
            node.status({
                fill: manual ? 'blue' : 'green',
                shape: event.shape,
                text:
                    event.name +
                    (manual ? ' manual' : ' auto') +
                    (isSuspended() ? ' - scheduling suspended' : ' until ' + event.inverse.moment.format(fmt))
            });
        }

        function schedule(event, isInitial) {
            var now = node.now();
            var matches = new RegExp(/(\d+):(\d+)/).exec(event.time);
            if (matches && matches.length) {
                // Don't use existing 'now' moment here as hour and minute mutate the moment.
                event.moment = node
                    .now()
                    .hour(+matches[1])
                    .minute(+matches[2]);
            } else {
                var sunCalcTimes = SunCalc.getTimes(new Date(), config.lat, config.lon);
                var date = sunCalcTimes[event.time];
                if (date) {
                    event.moment = moment(date);
                }
            }
            if (!event.moment) {
                node.status({
                    fill: 'red',
                    shape: 'dot',
                    text: 'Invalid time: ' + event.time
                });
                return false;
            }
            event.moment.seconds(0);

            if (event.offset) {
                var adjustment = event.offset;
                if (event.randomoffset) {
                    adjustment = event.offset * Math.random();
                }
                event.moment.add(adjustment, 'minutes');
            }

            if (!isInitial || (isInitial && now.isAfter(event.moment))) {
                event.moment.add(1, 'day');
            }

            // Adjust weekday if not selected
            while (!weekdays[event.moment.isoWeekday() - 1]) {
                event.moment.add(1, 'day');
            }

            var delay = event.moment.diff(now);
            if (event.timeout) {
                clearTimeout(event.timeout);
            }
            event.timeout = setTimeout(event.callback, delay);
            return true;
        }

        function suspend() {
            clearTimeout(events.on.timeout);
            events.on.moment = null;
            clearTimeout(events.off.timeout);
            events.off.moment = null;
            node.status({
                fill: 'grey',
                shape: 'dot',
                text:
                    'Scheduling suspended ' +
                    (weekdays.indexOf(true) === -1 ? '(no weekdays selected) ' : '') +
                    '- manual mode only'
            });
        }

        function resume() {
            if (schedule(events.on, true) && schedule(events.off, true)) {
                var firstEvent = events.on.moment.isBefore(events.off.moment) ? events.on : events.off;
                var message =
                    firstEvent.name +
                    ' ' +
                    firstEvent.moment.format(fmt) +
                    ', ' +
                    firstEvent.inverse.name +
                    ' ' +
                    firstEvent.inverse.moment.format(fmt);
                node.status({
                    fill: 'yellow',
                    shape: 'dot',
                    text: message
                });
            }
        }

        function bootstrap() {
            if (isSuspended()) {
                suspend();
            } else {
                resume();
            }
        }

        function isSuspended() {
            return config.suspended || weekdays.indexOf(true) === -1;
        }

        function enumerateOnOffEvents(callback) {
            // The keys here will be ['on', 'off']
            Object.keys(events).forEach(function(eventType) {
                callback(eventType, 'time', String);
                callback(eventType, 'topic', String);
                callback(eventType, 'payload', String);
                callback(eventType, 'offset', Number);
                callback(eventType, 'randomoffset', toBoolean);
            });
        }

        function toBoolean(val) {
            return (val + '').toLowerCase() === 'true';
        }

        // Bodge to allow testing
        node.schedexEvents = function() {
            return events;
        };

        // Bodge to allow testing
        node.now = function() {
            return moment();
        };

        bootstrap();
    });
};
