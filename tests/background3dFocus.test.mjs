import assert from 'node:assert/strict';
import test from 'node:test';
import {backgroundFocusPolygon,backgroundFocusContains} from '../src/lib/background3dFocusGeometry.ts';
test('spotlight follows slanted panel edges and the background capture crop',()=>{
 const polygon=[{x:10,y:10},{x:90,y:30},{x:90,y:90},{x:10,y:90}];
 const clipped=backgroundFocusPolygon(polygon,{left:30,top:0,right:80,bottom:75});
 assert.deepEqual(clipped,[{x:30,y:15},{x:80,y:27.5},{x:80,y:75},{x:30,y:75}]);
 assert.deepEqual(polygon,[{x:10,y:10},{x:90,y:30},{x:90,y:90},{x:10,y:90}]);
});
test('offscreen crops have no hole and partly visible crops stop at the workspace edge',()=>{
 const polygon=[{x:10,y:10},{x:90,y:10},{x:90,y:90},{x:10,y:90}];
 assert.deepEqual(backgroundFocusPolygon(polygon,{left:100,top:0,right:200,bottom:200}),[]);
 assert.deepEqual(backgroundFocusPolygon(polygon,{left:0,top:0,right:100,bottom:100},{left:0,top:40,right:60,bottom:120}),[{x:60,y:40},{x:60,y:90},{x:10,y:90},{x:10,y:40}]);
 assert.deepEqual(backgroundFocusPolygon(polygon,{left:0,top:100,right:100,bottom:50}),[]);
});

test('scope hits are limited to the clipped visible polygon, including angled panels',()=>{
 const polygon=backgroundFocusPolygon([{x:0,y:0},{x:600,y:0},{x:0,y:400}],{left:20,top:20,right:580,bottom:380});
 assert.equal(backgroundFocusContains(polygon,{x:200,y:100}),true);
 for(const point of [{x:480,y:320},{x:10,y:10},{x:200,y:390}])assert.equal(backgroundFocusContains(polygon,point),false);
 assert.equal(backgroundFocusContains([],{x:1,y:1}),false);
});
