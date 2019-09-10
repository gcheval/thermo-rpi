"use strict";
var Service, Characteristic, HomebridgeAPI;
var thermostat = require('./Thermostat');

module.exports = function register(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    HomebridgeAPI = homebridge;

    homebridge.registerAccessory('thermo-rpi', 'ThermoRpi', thermostat.createThermostat({
        Service,
        Characteristic,
    }));
};