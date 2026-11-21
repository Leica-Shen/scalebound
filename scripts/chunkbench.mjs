import { generateChunk } from '../src/core/terrain.js';
const t=Date.now(); for(let i=0;i<40;i++) generateChunk(i%7, Math.floor(i/7)); console.log('40 chunks ms', Date.now()-t);
