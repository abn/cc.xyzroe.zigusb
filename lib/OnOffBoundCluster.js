'use strict';

const { BoundCluster } = require('zigbee-clusters');
const { CLUSTER } = require('zigbee-clusters');

class OnOffBoundCluster extends BoundCluster {

  constructor({
    onSetOff, onSetOn,
  }) {
    super();
    this._onSetOff = onSetOff;
    this._onSetOn = onSetOn;
  }

  setOn() {
    if (typeof this._onSetOn === 'function') {
      this._onSetOn();
    }
  }

  setOff() {
    if (typeof this._onSetOff === 'function') {
      this._onSetOff();
    }
  }

}

OnOffBoundCluster.clusterId = CLUSTER.ON_OFF;

module.exports = { OnOffBoundCluster };
