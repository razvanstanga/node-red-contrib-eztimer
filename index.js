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

module.exports = function (RED) {
    'use strict';

    var moment = require('moment');
    var SunCalc = require('suncalc');
    var _ = require("lodash");
    var fmt = 'YYYY-MM-DD HH:mm';

    RED.nodes.registerType('schedex', function (config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.log(JSON.stringify(config, null, 4));
        var events = {
            on: setupEvent('on', 'dot'),
            off: setupEvent('off', 'ring')
        };
        events.on.inverse = events.off;
        events.off.inverse = events.on;

        node.on('input', function (msg) {
            var event = events[msg.payload];
            if (event) {
                send(event, true);
            } else {
                node.status({fill: 'red', shape: 'dot', text: 'Manual payload must be \'on\' or \'off\''});
            }
        });

        node.on('close', function () {
            clearTimeout(events.on.timeout);
            clearTimeout(events.off.timeout);
        });

        function setupEvent(eventName, shape) {
            var filtered = _.pickBy(config, function (value, key) {
                return key && key.indexOf(eventName) === 0;
            });
            var event = _.mapKeys(filtered, function (value, key) {
                return key.substring(eventName.length).toLowerCase();
            });
            event.name = eventName.toUpperCase();
            event.shape = shape;
            event.callback = function () {
                send(event);
                schedule(event);
            };
            node.log(JSON.stringify(event, null, 4));
            return event;
        }

        function send(event, manual) {
            node.send({topic: event.topic, payload: event.payload});
            node.status({
                fill: manual ? 'blue' : 'green',
                shape: event.shape,
                text: event.name + (manual ? ' manual' : ' auto') + ' until ' + event.inverse.moment.format(fmt)
            });
        }

        function schedule(event, isInitial) {
            var now = moment();
            var matches = new RegExp(/(\d+):(\d+)/).exec(event.time);
            if (matches && matches.length) {
                // Don't use 'now' here as hour and minute mutate the moment.
                event.moment = moment().hour(matches[1]).minute(matches[2]);
            } else {
                var sunCalcTimes = SunCalc.getTimes(new Date(), config.lat, config.lon);
                var date = sunCalcTimes[event.time];
                if (date) {
                    event.moment = moment(date);
                }
            }
            if (event.moment) {
                event.moment.seconds(0);
                if (!isInitial || isInitial && now.isAfter(event.moment)) {
                    event.moment.add(1, 'day');
                }
                if (event.offset) {
                    var adjustment = event.offset;
                    if (event.randomoffset) {
                        adjustment = event.offset * Math.random();
                    }
                    event.moment.add(adjustment, 'minutes');
                }

                var delay = event.moment.diff(now);
                node.log(event.name + ' scheduled for: ' + event.moment.format(fmt) + ' delay: ' + delay);
                if (event.timeout) {
                    clearTimeout(event.timeout);
                }
                event.timeout = setTimeout(event.callback, delay);
            } else {
                node.status({fill: 'red', shape: 'dot', text: 'Invalid time: ' + event.time});
            }
        }

        schedule(events.on, true);
        schedule(events.off, true);
        var firstEvent = events.on.moment.isBefore(events.off.moment) ? events.on : events.off;
        var message = firstEvent.name + ' ' + firstEvent.moment.format(fmt) + ', ' +
            firstEvent.inverse.name + ' ' + firstEvent.inverse.moment.format(fmt);
        node.log(message);
        node.status({fill: 'yellow', shape: 'dot', text: message});
    });
};