import { readJsonData } from './common.js'
import { SharedDataProxy } from './shared-data-proxy.js'
import { ArtifactFrame } from './viewer/artifact-frame.js'

const viewerConfig = readJsonData('viewer-config')
new ArtifactFrame(document.getElementById('artifact-frame'), { version: viewerConfig.shownVersion, sharedData: new SharedDataProxy(viewerConfig) })
