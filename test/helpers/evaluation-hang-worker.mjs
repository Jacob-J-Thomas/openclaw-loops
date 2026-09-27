import {parentPort} from 'node:worker_threads';

parentPort?.on('message',()=>{globalThis.setInterval(()=>{},1000);});
