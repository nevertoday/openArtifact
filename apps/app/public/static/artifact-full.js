import { readJsonData } from './common.js'
import { SharedDataProxy } from './shared-data-proxy.js'

new SharedDataProxy(document.getElementById('artifact-frame'), readJsonData('viewer-config'))
