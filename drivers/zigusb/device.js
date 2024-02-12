'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');

const { CLUSTER } = require('zigbee-clusters');
const { OnOffBoundCluster } = require('../../lib/OnOffBoundCluster');

/**
 * When given a duration in seconds, generate human-readable text of the form 1y, 10d, 5h, 30m, 10s.
 *
 * @param {number} seconds - Duration in seconds.
 * @return {string} Human friendly duration string.
 */
function formatDuration(seconds) {
  const years = Math.floor(seconds / 31536000);
  const days = Math.floor((seconds % 31536000) / 86400);
  const hours = Math.floor(((seconds % 31536000) % 86400) / 3600);
  const minutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
  const remainingSeconds = seconds % 60;

  const result = [];

  if (years > 0) result.push(`${years}y`);
  if (days > 0) result.push(`${days}d`);
  if (hours > 0) result.push(`${hours}h`);
  if (minutes > 0) result.push(`${minutes}m`);
  if (remainingSeconds > 0) result.push(`${remainingSeconds}s`);

  return result.join(', ');
}

class ZigUSBDevice extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {
    await this.registerOnOff()
      .catch(this.error);
    await this.registerMeasureTemperature()
      .catch(this.error);
    await this.registerPowerMetering()
      .catch(this.error);
    await this.registerUptime()
      .catch(this.error);
  }

  analogInputValueKey(endpointId) {
    return `analog_input_value_${endpointId}`;
  }

  getAnalogInputValue(endpointId) {
    return this.getStoreValue(this.analogInputValueKey(endpointId)) ?? 0.0;
  }

  onSwitchOn() {
    this.debug('Switch turned on');
    this.setCapabilityValue('onoff', true)
      .catch(this.error);
  }

  onSwitchOff() {
    this.debug('Switch turned off');
    this.setCapabilityValue('onoff', false)
      .catch(this.error);
  }

  async configureAnalogInputPresentValueAttributeReporting(endpointId) {
    await this.configureAttributeReporting([
      {
        endpointId,
        cluster: CLUSTER.ANALOG_INPUT,
        attributeName: 'presentValue',
        minInterval: 30,
        maxInterval: 60,
        minChange: 0.0001,
      },
    ])
      .catch(this.error);
  }

  async configureAnalogInputValueListener(endpointId) {
    const storeKey = this.analogInputValueKey(endpointId);

    if (!(storeKey in this.getStoreKeys())) {
      // if the given endpoint is not yet in the store, create an entry and configure listener
      // on the `presentValue` attribute
      await this.configureAnalogInputPresentValueAttributeReporting(endpointId);

      this.zclNode.endpoints[endpointId].clusters.analogInput.on(
        'attr.presentValue',
        (value) => {
          this.debug(`Present value was updated for analog input cluster (endpoint: ${endpointId}, value: ${value})`);
          this.setStoreValue(storeKey, value);
        },
      );
    }
  }

  /**
   * Registers a description-based analog input reporting listener. For devices such as the ZigUSB that uses the PTVO
   * analog input cluster to report multiple values (Current, Voltage, Power etc.), following the reporting of the
   * `presentValue` attribute containing the latest numeric value, a new report for the `description` attribute is sent.
   *
   * The new value for the `description` attribute is of the format `<unit>,<device id>`. For our purposes, the `<device id>`
   * can be safely ignored. The value of `<unit>` maybe one of "A" (Current), "V" (Voltage) or "W" (Power).
   *
   * When a description prefixed with `${descriptionUnit},` is received, the last known value for `presentValue` attribute is
   * retrieved from the device key store and used as latest value for the specified capability.
   *
   * @param {string} capabilityId - The ID of the capability to register the analog input cluster for.
   * @param {string} endpointId - The ID of the endpoint containing the analog input cluster to use.
   * @param {string} descriptionUnit - The unit to match relevant description values received.
   * @param {number} [multiplier=1] - The multiplier to apply to raw value prior to setting as capability value.
   *
   * @return {Promise<void>} - A promise that resolves when the capability is registered.
   */
  async registerDescBasedAnalogInputCapability(capabilityId, endpointId, descriptionUnit, multiplier = 1) {
    // create a listener for reports containing values for `presentValue` attribute for this endpoint, the listener
    // stores the last received values into the device's key store
    await this.configureAnalogInputValueListener(endpointId);

    this.registerCapability(capabilityId, CLUSTER.ANALOG_INPUT, {
      endpoint: endpointId,
      get: 'description',
      report: 'description',
      reportParser: (value) => {
        let parsedValue = null;

        if (value && value.startsWith(`${descriptionUnit},`)) {
          const presentValue = this.getAnalogInputValue(endpointId);
          const multipliedValue = Math.max(0.00, presentValue) * multiplier;

          parsedValue = Number(multipliedValue.toFixed(2)) * multiplier;

          this.debug(
            'Analog input cluster value update requested',
            `(endpoint: ${endpointId}, capability: ${capabilityId}, value: ${parsedValue}, raw: ${presentValue})`,
          );
        }

        return parsedValue;
      },
    });
  }

  async registerOnOff() {
    const endpointId = 1;
    const onOffClusterEndpoint = this.zclNode.endpoints[endpointId];
    const onOffCluster = onOffClusterEndpoint.clusters.onOff;

    this.registerCapability('onoff', CLUSTER.ON_OFF, {
      endpoint: endpointId,
      // The default ZigUSB device has an inverted boolean for on/off
      set: (value) => (value ? 'setOff' : 'setOn'),
      setParser: (value) => {
        return !value;
      },
      reportParser: (value) => {
        return !value;
      },
    });

    const onOffBoundCluster = new OnOffBoundCluster({
      // on/off are deliberately inverted
      onSetOn: this.onSwitchOff.bind(this),
      onSetOff: this.onSwitchOn.bind(this),
    });
    onOffClusterEndpoint.bind(CLUSTER.ON_OFF.NAME, onOffBoundCluster);

    // set current value
    await onOffCluster.readAttributes(
      ['onOff'],
    )
      .then(async (result) => {
        await this.setCapabilityValue('onoff', !result['onOff']);
      })
      .catch(this.error);
  }

  async registerMeasureTemperature() {
    this.registerCapability('measure_temperature', CLUSTER.TEMPERATURE_MEASUREMENT, {
      endpoint: 4,
    });
  }

  async registerPowerMetering() {
    await this.registerDescBasedAnalogInputCapability('measure_current', 2, 'A');
    await this.registerDescBasedAnalogInputCapability('measure_voltage', 2, 'V');
    await this.registerDescBasedAnalogInputCapability('measure_power', 2, 'W');
  }

  async registerUptime() {
    const endpointId = 5;
    const capabilityId = 'measure_uptime';

    await this.configureAnalogInputPresentValueAttributeReporting(endpointId);

    this.zclNode.endpoints[endpointId].clusters.analogInput.on(
      'attr.presentValue',
      (value) => {
        const duration = formatDuration(value);
        this.debug(`Uptime value was updated (endpoint: ${endpointId}, value: ${value}), duration: ${duration}`);
        this.setCapabilityValue(capabilityId, duration);
      },
    );

    this.registerCapability(capabilityId, CLUSTER.ANALOG_INPUT, {
      endpoint: endpointId,
    });
  }

}

module.exports = ZigUSBDevice;
