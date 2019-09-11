let Service, Characteristic;

module.exports = {
    createThermostat: function({Service, Characteristic}) {
        const sensorLib = require('node-dht-sensor');
        const gpio = require('rpi-gpio');
        const debug = require('debug');
        const ON = false, OFF = true;
        const OSCILLATION_DEGREES = 2;
        const
            STATE_OFF = 0,
            STATE_STANDBY = 1,
            STATE_START = 2,
            STATE_STARTING_FAN = 3,
            STATE_COMPRESSOR_STAGE = 4,
            STATE_START_COMPRESSOR = 5,
            STATE_COMPRESSOR_RAMPUP = 6,
            STATE_COMPRESSOR_RUNNING = 7,
            STATE_STOPPING_COMPRESSOR = 8,
            STATE_COMPRESSOR_COOLDOWN = 9
        ;
        const MIN_COMPRESSOR_RAMPUP_MINUTES = 3;
        const MIN_COMPRESSOR_COOLDOWN_MINUTES = 1;
        const ONE_SECOND_IN_MS = 1000;
        const SECONDS_IN_A_MINUTE = 60;

        return class Thermostat {
            constructor(log, config) {
                this.state = 0;
                this.manufacturer = 'guicheva-rpi';
                this.model = 'thermostat-rpi';
                this.serial = '00001';
                this.log = log;
                this.name = config.name;
                this.type = config.tempSensorType;
                this.pin = config.tempGpioPin;
                this.compressorPin = config.compressorGpioPin;
                this.fanPin = config.fanGpioPin;
                this.cacheTimeout = config.cacheTimeout || (60 * 1000); // 1 minute
                this.pollingInterval = config.pollingInterval || 5000;

                this.targetCoolingState = Characteristic.TargetHeatingCoolingState.OFF; //OFF
                this.currentTemperature = 0;
                this.targetTemperature = 25;
                this.minTemp = 15;
                this.maxTemp = 30;
                this.currentHumidity = 0;
                this.lastUpdate = null;
                this.fanLastStarted = null;
                this.compressorLastStarted = null;
                this.compressorLastStopped = null;

                this.humidityService = new Service.HumiditySensor(this.name);
                this.temperatureService = new Service.TemperatureSensor(this.name);

                this.log("setup GPIO");
                gpio.setup(this.fanPin, gpio.DIR_HIGH);
                gpio.setup(this.compressorPin, gpio.DIR_HIGH);

                if (this.pollingInterval) {
                    setInterval(() => {
                        this.getValue(null, (err, values) => {
                            const {humidity, temperature} = values || {}
                            if (err) {
                                this.log(err)
                                return;
                            }
                            this.service.setCharacteristic(Characteristic.CurrentTemperature, temperature);
                            this.service.setCharacteristic(Characteristic.CurrentRelativeHumidity, humidity);
                        })
                    }, this.pollingInterval)
                }
                this.service = new Service.Thermostat(this.name);
            }

            getName(callback) {
                this.log("getName :", this.name);
                callback(null, this.name);
            }

            getTargetTemperature(callback) {
                this.log("[+] getTargetTemperature: " + this.targetTemperature);
                callback(null, this.targetTemperature);
            }

            setTargetTemperature(value, callback) {
                this.log("[+] setTargetTemperature from %s to %s", this.targetTemperature, value);
                this.targetTemperature = value;
                callback();
            }

            getTargetHeatingCoolingState(callback) {
                this.log("[+] getTargerHeatingCoolingState from: %s", this.targetCoolingState);
                callback(null, this.targetCoolingState);
            }

            setTargetHeatingCoolingState(value, callback) {
                this.log("[+] setTargetHeatingCoolingState from %s to %s", this.targetCoolingState, value);
                this.targetCoolingState = value;
                callback();
            }

            getValue(what, callback) {
                sensorLib.read(this.type, this.pin, (err, temperature = 0, humidity = 0) => {
                    if (!err && humidity !== 0 && temperature !== 0) {
                        this.currentHumidity = humidity
                        this.currentTemperature = temperature
                        this.lastUpdate = Date.now()
                    }

                    if (Date.now() - this.lastUpdate >= this.cacheTimeout) {
                        return callback(err || new Error('cannot get sensor data'), null);
                    }

                    debug("[+] Current machine state is %d", this.state);
                    //State machine
                    this.log("[+] Current state is %d", this.state);
                    switch(this.state) {
                        case STATE_OFF: // Stop everything
                            gpio.write(this.compressorPin, OFF);
                            gpio.write(this.fanPin, OFF);
                            this.fanLastStarted = null;
                            this.compressorLastStarted = null;
                            this.state = STATE_STANDBY;
                            break;
                        case STATE_STANDBY: // Stand-by
                            if (this.targetCoolingState === Characteristic.TargetHeatingCoolingState.COOL) {
                                this.state = STATE_START;
                            }
                            break;
                        case STATE_START:
                            gpio.write(this.fanPin, ON);
                            this.fanLastStarted = Date.now();
                            this.state = STATE_STARTING_FAN;
                            break;
                        case STATE_STARTING_FAN:
                            this.log("this.targetCoolingState: %s. Characteristic.TargetHeatingCoolingState.OFF: %s.", this.targetCoolingState, Characteristic.TargetHeatingCoolingState.OFF);
                            if (this.targetCoolingState === Characteristic.TargetHeatingCoolingState.OFF) {
                                this.state = STATE_OFF;
                            } else if ((Date.now() - ONE_SECOND_IN_MS * 10) > this.fanLastStarted) {
                                this.state = STATE_COMPRESSOR_STAGE;
                            }
                            break;
                        case STATE_COMPRESSOR_STAGE:
                            this.log("Current: %s. Target: %s.", this.currentTemperature, (this.targetTemperature + OSCILLATION_DEGREES));
                            if (this.targetCoolingState === Characteristic.TargetHeatingCoolingState.OFF) {
                                this.state = STATE_OFF;
                            } else if ((this.currentTemperature > this.targetTemperature + OSCILLATION_DEGREES) && (!this.compressorLastStopped || (Date.now() - ONE_SECOND_IN_MS * SECONDS_IN_A_MINUTE * MIN_COMPRESSOR_RAMPUP_MINUTES) > this.compressorLastStopped)) {
                                this.state = STATE_START_COMPRESSOR;
                            }
                            break;
                        case STATE_START_COMPRESSOR:
                            gpio.write(this.compressorPin, ON);
                            this.compressorLastStarted = Date.now();
                            this.state = STATE_COMPRESSOR_RAMPUP;
                            break;
                        case STATE_COMPRESSOR_RAMPUP:
                            if ((Date.now() - ONE_SECOND_IN_MS * SECONDS_IN_A_MINUTE * MIN_COMPRESSOR_RAMPUP_MINUTES) > this.compressorLastStarted) {
                                this.state = STATE_COMPRESSOR_RUNNING;
                            }
                            break;
                        case STATE_COMPRESSOR_RUNNING:
                            if (this.targetCoolingState === Characteristic.TargetHeatingCoolingState.OFF) {
                                this.state = STATE_STOPPING_COMPRESSOR;
                            } else if (this.currentTemperature < this.targetTemperature - OSCILLATION_DEGREES) {
                                gpio.write(this.compressorPin, OFF);
                                this.compressorLastStopped = Date.now();
                                this.state = STATE_COMPRESSOR_STAGE;
                            }
                            break;
                        case STATE_STOPPING_COMPRESSOR:
                            gpio.write(this.compressorPin, OFF);
                            this.compressorLastStopped = Date.now();
                            this.state = STATE_COMPRESSOR_COOLDOWN;
                            break;
                        case STATE_COMPRESSOR_COOLDOWN:
                            if ((Date.now() - ONE_SECOND_IN_MS * SECONDS_IN_A_MINUTE * MIN_COMPRESSOR_COOLDOWN_MINUTES) > this.compressorLastStopped) {
                                if (this.targetCoolingState === Characteristic.TargetHeatingCoolingState.COOL) {
                                    this.state = STATE_START;
                                } else {
                                    gpio.write(this.fanPin, OFF);
                                    this.state = STATE_STANDBY;
                                }
                            }
                            break;
                    }

                    switch (what) {
                        case 'temperature':
                            return callback(null, this.currentTemperature);
                        case 'humidity':
                            return callback(null, this.currentHumidity);
                        default:
                            return callback(null, {humidity: this.currentHumidity, temperature: this.currentTemperature});
                    }
                })
            }




            getServices() {
                this.informationService = new Service.AccessoryInformation();
                this.informationService
                    .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
                    .setCharacteristic(Characteristic.Model, this.model)
                    .setCharacteristic(Characteristic.SerialNumber, this.serial);

                this.service
                    .getCharacteristic(Characteristic.CurrentRelativeHumidity)
                    .on('get', this.getValue.bind(this, 'humidity'));

                this.service
                    .getCharacteristic(Characteristic.CurrentTemperature)
                    .on('get', this.getValue.bind(this, 'temperature'))
                                    .setProps({
                                        minValue: -100,
                                        maxValue: 100,
                                        minStep: 0.1
                                    });

                this.service
                    .getCharacteristic(Characteristic.TargetTemperature)
                    .on('get', this.getTargetTemperature.bind(this))
                    .on('set', this.setTargetTemperature.bind(this));
                this.service.getCharacteristic(Characteristic.TargetTemperature)
                    .setProps({
                        minValue: this.minTemp,
                        maxValue: this.maxTemp,
                        minStep: 0.5
                    });

                this.service
                    .getCharacteristic(Characteristic.TargetHeatingCoolingState)
                    .on('get', this.getTargetHeatingCoolingState.bind(this))
                    .on('set', this.setTargetHeatingCoolingState.bind(this))
                    .setProps({
                        validValues: [
                            Characteristic.TargetHeatingCoolingState.OFF,
                            Characteristic.TargetHeatingCoolingState.COOL
                        ]});

                this.service
                    .getCharacteristic(Characteristic.Name)
                    .on('get', this.getName.bind(this));

                return [this.informationService, this.service];
            }
        }
    }
};