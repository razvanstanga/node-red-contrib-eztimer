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
        var node = this, cronJobOn, cronJobOff, on, off;
        // node.log(JSON.stringify(config, null, 4));

        node.on('input', function (msg) {
            try {
                switch (msg.payload) {
                    case 'on':
                    case 'ON':
                    case 1:
                        send('on', true);
                        break;
                    case 'off':
                    case 'OFF':
                    case 0:
                        send('off', true);
                        break;
                    default:
                }
            } catch (error) {
                node.log(error.stack);
                node.error(error, msg);
                node.status({fill: 'red', shape: 'dot', text: error.message});
            }
        });

        node.on('close', function () {
            cronJobOn.stop();
            cronJobOff.stop();
        });

        function send(event, manual) {
            var isOn = event === 'on';
            node.send({topic: config[event + 'Topic'], payload: config[event + 'Payload']});
            node.status({
                fill: manual ? 'blue' : 'green',
                shape: isOn ? 'dot' : 'ring',
                text: event.toUpperCase() + (manual ? ' manual' : ' auto') + ' until ' + (isOn ? off.format(fmt) : on.format(fmt))
            });
        }

        function cronInvokedOn() {
            send('on', false);
            on = momentFor(config.on, config.onOffset, config.onRandomOffset).add(1, 'day');
            cronJobOn = new cron.CronJob(on.toDate(), cronInvokedOn, null, true);
            node.log('On until ' + off.format(fmt));
        }

        function cronInvokedOff() {
            send('off', false);
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

            var message = 'ON ' + on.format(fmt) + ', OFF ' + off.format(fmt);
            node.log(message);
            node.status({fill: 'yellow', shape: 'dot', text: message});
        })();
    });
};