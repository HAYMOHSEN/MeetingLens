'use strict';
const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild'),root=__dirname;
esbuild.buildSync({entryPoints:[path.join(root,'studio3d.src.js')],outfile:path.join(root,'studio3d.bundle.js'),bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022',external:['fs','path'],legalComments:'eof'});
fs.copyFileSync(path.join(root,'node_modules/xatlas-web/dist/xatlas-web.wasm'),path.join(root,'assets/xatlas-web.wasm'));
fs.mkdirSync(path.join(root,'licenses'),{recursive:true});
for(const pkg of ['three','three-gpu-pathtracer','three-mesh-bvh','xatlas-web'])fs.copyFileSync(path.join(root,'node_modules',pkg,'LICENSE'),path.join(root,'licenses',pkg+'.txt'));
console.log('Offline 3D bundle built.');
