let Service, Characteristic;

module.exports = {
    createThermostat: function({Service, Characteristic}) {
        const sensorLib = require('node-dht-sensor');
        const ON = false, OFF = true;
        let gpio = require('rpi-gpio');

        return class Thermostat {
            constructor(log, config) {
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

                this.humidityService = new Service.HumiditySensor(this.name);
                this.temperatureService = new Service.TemperatureSensor(this.name);

                gpio.setup(this.fanPin, gpio.DIR_HIGH, this.fan);

                if (this.pollingInterval) {
                    setInterval(() => {
                        this.getValue(null, (err, values) => {
                            const {humidity, temperature} = values || {}
                            if (err) {
                                this.log(err)
                                return
                            }

                            this.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, humidity)
                            this.temperatureService.setCharacteristic(Characteristic.CurrentTemperature, temperature)
                        })
                    }, this.pollingInterval)
                }
                this.service = new Service.Thermostat(this.name);
            }

            fan(err) {
                console.log('Writing to pin');
                // if (err) this.log(err);
                // gpio.write(this.fanPin, ON, function(err) {
                //     if (err) this.log(err);
                //     console.log('Written to pin');
                // });
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
                        return callback(err || new Error('cannot get sensor data'), null)
                    }

                    switch (what) {
                        case 'temperature':
                            return callback(null, this.currentTemperature)
                        case 'humidity':
                            return callback(null, this.currentHumidity)
                        default:
                            return callback(null, {humidity: this.currentHumidity, temperature: this.currentTemperature})
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

            // getServices() {
            //     return [this.humidityService, this.temperatureService]
            // }

        }
    }
}