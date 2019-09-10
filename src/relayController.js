"use strict";
const raspi = require('raspi');
var gpio = require('rpi-gpio');
const sensorLib = require('node-dht-sensor');
const RELAY_ON = false;
const RELAY_OFF = true;

var pin = '3'; //GPIO2

gpio.setup(pin, gpio.DIR_OUT, write);
function write(err) {
    if (err) throw err;
    gpio.write(pin, false, function(err) {
        if (err) throw err;
        console.log('Written to pin');
    });
}

function createRelayController({ Service, Characteristic }) {
    return class RelayController {
        constructor(log, config) {
            this.log = log;
            this.name = config.name;
        }
    }
}
module.exports = createRelayController;