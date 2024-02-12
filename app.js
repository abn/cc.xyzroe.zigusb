'use strict';

const Homey = require('homey');

class ZigUSBApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('ZigUSBApp has been initialized');
  }

}

module.exports = ZigUSBApp;
