# eztimer

Timer/scheduler for node-red which allows you to enter on/off times as 24hr clock (e.g. 01:10) or suncalc events (e.g.
goldenHour). It also allows you to offset times and randomise the time within the offset.

Forked from (retaining much of the code, including this document) [schedex](https://github.com/biddster/node-red-contrib-schedex) which was in turn inspired by Pete Scargill's [BigTimer](http://tech.scargill.net/big-timer/), so
hat-tip to both those coders.

Emphasis has been put on creating a simple interface and utilising built-in node-red formatting helpers (such as creating
a JSON payload).

# Installation

This node requires node 4.x. It's tested against 4.6.1.

    $ cd ~/.node-red
    $ npm install node-red-contrib-eztimer

# Configuration

## Schedule

The scheduling days allow you to choose which days of the week to schedule events. Unticking all days will suspend
scheduling.

## Suspending scheduling

The **Suspend Scheduling** checkbox allows you to disable time scheduling. If scheduling is suspended, eztimer will only
generate output events upon receipt of input `on` and `off` events (see below).

This setting is provided for the situation where you temporarily don't want time based activation and don't want to
rewire your Node-RED flow.

## Times

Select the type of trigger from the dropdown and this will provide either a fruther dropdown (for suncalc events), or a textbox to enter either a 24hr time (HH:mm[:ss]) or, for the `off` event, a duration (hh:mm:ss).

As of `1.1.1` it is supported to specify timespans in numerous timespan formats:

| input | interpretation
|-------|-----------------------------
| `"12:14"` | 12 hours and 14 minutes
| `"12:14:24"` | 12 hours, 14 minutes and 24 seconds
| `"23h 5m"` | 23 hours and 5 minutes
| `"5m"` | 5 minutes
| `"90s"` | 1 minute and 30 seconds (90 seconds)
| `300` | 5 minutes (300 seconds) - integers are interpreted as seconds

These are valid both at UI/config-time and at runtime using the `duration` payload.


## Offsets

The on and off time can have an offset. This is specified in minutes:

* -ve number brings the time forward. E.g. if the time is dusk and offset is -60, a message will be generated 60 minutes
  before dusk.
* +ve number delays the time by the specified number of minutes

## Randomisation of times

Both `on` and `off` times can be randomised by ticking "Use random time within offset period". For example, if you specify
dusk with an offset of -60 minutes, every day a message will be generated at a random time in a 60 minute window before
dusk.

## Suppression of repeating events

In some circumstances it may be required to re-start the timer _without_ re-sending the `on` event - this setting achieves this.  It's available for both `on` and `off` events, but disabled in `trigger` mode.

## Inputs

You can wire inject nodes to the input of this node and send the following in `msg.payload`.

| msg.payload | Description                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `trigger`   | Causes eztimer to emit the configured trigger event. |
| `on`        | Triggers manual on mode and causes eztimer to emit the configured `on` event. Manual mode is reset when the next `on` or `off` time is reached |
| `off`       | Triggers manual off mode and causes eztimer to emit the configured `off` event. Manual mode is reset when the next `on` or `off` time is reached |
| `info`      | Eztimer emits an object containing the `on` and `off` times in UTC format. It also contains the state which is either `on` or `off`. |
| `cancel`    | Cancels the current run (if any) of the timer (_without_ emitting an `off` event). |

# Programmatic Control

This node supports programmatic time control as well as configuration via the NodeRED UI.

**It is very important to note that properties set programmatically in this manner are transient. They will not persist over a NodeRED restart or redeploy!**

Note that both the property-based and string-based specifications are overrides that violate the usual behavior. 
See here for further discussion https://github.com/node-red/node-red/issues/399.

You can set the following:

| Property                      | Type                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `msg.payload.suspended`       | Boolean: true will suspend scheduling, false will resume scheduling   |
| `msg.payload.ontime`          | String value representing time of day (HH:mm[:ss])                    |
| `msg.payload.triggertime`     | Alias of `ontime`                                                     |
| `msg.payload.ontopic`         | String value emitted as the topic for the on event                    |
| `msg.payload.onvalue`         | Update output value for on event (must be same as configured type)    |
| `msg.payload.triggervalue`    | Alias of `onvalue`                                                    |
| `msg.payload.onoffset`        | Number value as specified above for Offset configuration              |
| `msg.payload.onrandomoffset`  | Boolean value as specified above in Randomisation of Times            |
| `msg.payload.offtime`         | String value representing time of day (HH:mm[:ss])                    |
| `msg.payload.duration`        | String value representing a timespan (see [Times](##Times))      |
| `msg.payload.offtopic`        | String value emitted as the topic for the off event                   |
| `msg.payload.offvalue`        | Update output value for off event (must be same as configured type)   |
| `msg.payload.offoffset`       | Number value as specified above for Offset configuration              |
| `msg.payload.offrandomoffset` | Boolean value as specified above in Randomisation of Times            |
| `msg.payload.mon`             | Boolean: true enables the schedule on a Monday, false disables it.    |
| `msg.payload.tue`             | Boolean: true enables the schedule on a Tuesday, false disables it.   |
| `msg.payload.wed`             | Boolean: true enables the schedule on a Wednesday, false disables it. |
| `msg.payload.thu`             | Boolean: true enables the schedule on a Thursday, false disables it.  |
| `msg.payload.fri`             | Boolean: true enables the schedule on a Friday, false disables it.    |
| `msg.payload.sat`             | Boolean: true enables the schedule on a Saturday, false disables it.  |
| `msg.payload.sun`             | Boolean: true enables the schedule on a Sunday, false disables it.    |

# Change Log

## 1.1.2
* Fixed bug introduced in 1.1.0 where some inputs arguments ceased to function correctly. [credit @marc-gist](https://github.com/mrgadget/node-red-contrib-eztimer/issues/13).

## 1.1.1
* Fixed `timestamp` value type (previously emitted a blank value) so it outputs milliseconds since epoch - the same as the built-in _input_ node. [credit @marc-gist](https://github.com/mrgadget/node-red-contrib-eztimer/issues/12).
 
## 1.1.0
A few changes in this one - have had it running in test for a month or two and believe it to be stable - as always, log any bugs at [github issues](https://github.com/mrgadget/node-red-contrib-eztimer/issues) and I'll tend to them as soon as possible.
* Added ability to change duration without resetting timer (enabling duration change while timer is on)
* Made duration more 'friendly' - 00:00, 00:00:00, 34m, 23s, 34m 4s, and even a plain integer (interpreted as seconds) are all valid for duration now.
* Added ability to _Suppress Repeated Events_. Meaning once an `on` event has been sent, repeatedly sending `on` inputs won't resend the `on` event (but it will restart the timer)
* Added `cancel` as input command (to cancel any existing timer run without emitting `off` event).
* Added `tag` config parameter.  This value is emitted with all events to allow easy identification of specific eztimer node the message was emitted from. Defaults to `eztimer`.
* Fixed issue where, when 1) using a duration event type _with_ 2) some days disabled _and_ 3) the timer is run manually on a disabled day, the `off` event would schedule on the next _available_ day (causing an abnormally long runtime).

## 1.0.14
* Added `nadir` to ordered sun event array

## 1.0.13
* Corrected invalid time received SunCalc based on events that don't happen at a particular lat/long by moving to the next closest valid event.  ie, if `night` was chosen, but doesn't exist, `nauticalDusk` would be used.  A warning is emitted each time an event is scheduled for a sun event different to that selected in the config. - [credit @B0F1B0](https://github.com/mrgadget/node-red-contrib-eztimer/issues/10).

## 1.0.12
* Error gracefully when sun events don't happen at particular lat/long (due to polar nights/days) - [credit @B0F1B0](https://github.com/mrgadget/node-red-contrib-eztimer/issues/9).

## 1.0.11
* Fixed programmatic alteration of day-of-week flag - [credit @stu-carter](https://github.com/mrgadget/node-red-contrib-eztimer/issues/8).

## 1.0.10
* Fixed bug where a manual `on` event (with a duration-based `off` event) wasn't scheduling it's `off` event.
* Enabled the use of seconds for time-based events (was documented but always reverted to 0).
* Added [missing] input parameter `payload.duration` to allow prgrammatic adjustment of the duration.
* Adjusted default value for `duration` to 00:01:00 (1 minute) - was 0, which broke the node.
* Fixed re-schedule after manual `off` event.
* Fixed state reporting in `info` output payload.
* Added node name to `info` output.  If no name is set, `eztimer` is returned.

Thanks to @stu-carter for detailed reports enabling the above fixes ([related issue](https://github.com/mrgadget/node-red-contrib-eztimer/issues/6)).

## 1.0.9
* Fixed `manual` variable being used before declaration - credit @marc-gist.
* Added UI tip for times and duration to make the HH:mm:ss requirement clearer - credit @stu-carter.

## 1.0.8
* Fixed next event status text for trigger.

## 1.0.7
* Corrected commands to set output value for on/off events - `onvalue` and `offvalue` are more correct, as it's not necessarily the payload you're updating. 
* Added `triggervalue` as an alias to `onvalue`.
* Values must match the configured value type.
* Removed the string command examples as they don't function correctly - the payload must be a JSON object to update a property value.

## 1.0.6
* Enabled startup events for `trigger`, configured off by default.  Caution required due to this being on by default for exisitng nodes.
* Fixed boolean data type to correctly output boolean rather than a string representation - credit @marc-gist.

## 1.0.5
* Fix `ontime` and `offtime` inputs, added `triggertime` as an alias of `ontime`.