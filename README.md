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

The 'Suspend scheduling' checkbox allows you to disable time scheduling. If scheduling is suspended, eztimer will only
generate output events upon receipt of input 'on' and 'off' events (see below).

This setting is provided for the situation where you temporarily don't want time based activation and don't want to
rewire your Node-RED flow.

## Times

Select the type of trigger from the dropdown and this will provide either a fruther dropdown (for suncalc events), or a text
box to enter either a 24hr time (HH:mm) or, for the off event, a duration (hh:mm:ss).

## Offsets

The on and off time can have an offset. This is specified in minutes:

* -ve number brings the time forward. E.g. if the time is dusk and offset is -60, a message will be generated 60 minutes
  before dusk.
* +ve number delays the time by the specified number of minutes

## Randomisation of times

Both on and off times can be randomised by ticking "Use random time within offset period". For example, if you specify
dusk with an offset of -60 minutes, every day a message will be generated at a random time in a 60 minute window before
dusk.

## Inputs

You can wire inject nodes to the input of this node and send the following in `msg.payload`.

| msg.payload | Description                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `trigger`   | Causes eztimer to emit the configured trigger event.                                                                                       |
| `on`        | Triggers manual on mode and causes eztimer to emit the configured on event. Manual mode is reset when the next on or off time is reached   |
| `off`       | Triggers manual off mode and causes eztimer to emit the configured off event. Manual mode is reset when the next on or off time is reached |
| `info`      | eztimer emits an object containing the on and off times in UTC format. It also contains the state which is either on or off.               |

'## Programmatic Control

This node supports programmatic time control as well as configuration via the NodeRED UI.

**It is very important to note that properties set programmatically in this manner are transient. They will not persist
over a NodeRED restart or redeploy!**

Note that both the property-based and string-based specifications are overrides that violate the usual behavior. 
See here for further discussion https://github.com/node-red/node-red/issues/399.

You can set the following:

| Property                      | Type                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `msg.payload.suspended`       | Boolean: true will suspend scheduling, false will resume scheduling   |
| `msg.payload.ontime`          | String value representing time of day (HH:mm:ss)                      |
| `msg.payload.triggertime`     | Alias of `ontime`                                                     |
| `msg.payload.ontopic`         | String value emitted as the topic for the on event                    |
| `msg.payload.onvalue`         | Update output value for on event (must be same as configured type)    |
| `msg.payload.triggervalue`    | Alias of `onvalue`                                                    |
| `msg.payload.onoffset`        | Number value as specified above for Offset configuration              |
| `msg.payload.onrandomoffset`  | Boolean value as specified above in Randomisation of Times            |
| `msg.payload.offtime`         | String value representing time of day (HH:mm:ss)                      |
| `msg.payload.duration`        | String value representing a timespan (HH:mm:ss)                      |
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

## 1.0.10
* Fixed bug where a manual `on` event (with a duration-based `off` event) wasn't scheduling it's `off` event.
* Enabled the use of seconds for time-based events (was documented but always reverted to 0).
* Added [missing] input parameter `payload.duration` to allow prgrammatic adjustment of the duration.
* Adjusted default value for `duration` to 00:01:00 (1 minute) - was 0, which broken the node.
* Fixed re-schedule after manual `off` event.
* Fixed state reporting in `info` output payload.

Thanks to @stu-carter for detailed reports enabling the above fixes.

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