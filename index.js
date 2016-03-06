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
    var cron = require("cron");
    var fmt = 'YYYY-MM-DD HH:mm';

    RED.nodes.registerType('schedex', function (config) {
        RED.nodes.createNode(this, config);
        var node = this, cronJobOn, cronJobOff, on , off;
        // node.log(JSON.stringify(config, null, 4));

        node.on('input', function (msg) {
            try {
                if (msg.payload === 'on') {
                    sendOn(true);
                } else if (msg.payload === 'off') {
                    sendOff(true);
                }
            } catch (error) {
                node.log(error.stack);
                node.error(error, msg);
                node.status({fill: 'red', shape: 'dot', text: error.message});
            }
        });

        node.on('close', function () {
            if (cronJobOn) {
                cronJobOn.stop();
            }
            if (cronJobOff) {
                cronJobOff.stop();
            }
        });

        function sendOn(manual) {
            node.send({topic: config.onTopic, payload: config.onPayload});
            node.status({
                fill: manual ? 'blue' : 'green',
                shape: 'dot',
                text: 'On ' + (manual ? 'manual' : 'auto') + ' until ' + off.format(fmt)
            });
        }

        function sendOff(manual) {
            node.send({topic: config.offTopic, payload: config.offPayload});
            node.status({
                fill: manual ? 'blue' : 'green',
                shape: 'ring',
                text: 'Off ' + (manual ? 'manual' : 'auto') + ' until ' + on.format(fmt)
            });
        }

        function cronInvokedOn() {
            sendOn(false);
            on = momentFor(config.on, config.onOffset, config.onRandomOffset).add(1, 'day');
            cronJobOn = new cron.CronJob(on.toDate(), cronInvokedOn, null, true);
            node.log('On until ' + off.format(fmt));
        }

        function cronInvokedOff() {
            sendOff(false);
            off = momentFor(config.off, config.offOffset, config.offRandomOffset).add(1, 'day');
            cronJobOff = new cron.CronJob(off.toDate(), cronInvokedOff, null, true);
            node.log('Off until ' + on.format(fmt));
        }

        function momentFor(time, offset, randomiseOffset) {
            var runAt;
            var matches = new RegExp(/(\d+):(\d+)/).exec(time);
            if (matches && matches.length) {
                runAt = moment().hour(matches[1]).minute(matches[2]);
            } else {
                var sunCalcTimes = SunCalc.getTimes(new Date(), config.lat, config.lon);
                var date = sunCalcTimes[time];
                if (date) {
                    runAt = moment(date);
                }
            }
            if (runAt) {
                runAt.seconds(0);
                if (offset) {
                    var adjusted = offset;
                    if (randomiseOffset) {
                        adjusted = offset * Math.random();
                    }
                    runAt.add(adjusted, 'minutes');
                }
            } else {
                node.status({fill: 'red', shape: 'dot', text: 'Invalid time: ' + time});
            }
            return runAt;
        }

        (function setupInitialSchedule() {
            var now = moment();

            on = momentFor(config.on, config.onOffset, config.onRandomOffset);
            if (now.isAfter(on)) {
                on.add(1, 'day');
            }
            cronJobOn = new cron.CronJob(on.toDate(), cronInvokedOn, null, true);

            off = momentFor(config.off, config.offOffset, config.offRandomOffset);
            if (now.isAfter(off)) {
                off.add(1, 'day');
            }
            cronJobOff = new cron.CronJob(off.toDate(), cronInvokedOff, null, true);

            var message = 'On ' + on.format(fmt) + ', Off ' + off.format(fmt);
            node.log(message);
            node.status({fill: 'yellow', shape: 'dot', text: message});
        })();
    });
};