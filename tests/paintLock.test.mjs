import assert from 'node:assert/strict';
import test from 'node:test';
import {newPaintLayer} from '../src/lib/paintDocument.ts';
import {paintLayerPatchAllowed,paintLayerEditable,paintContentsLocked,artworkLocked,paintOwnerPlacementLocked} from '../src/lib/paintLock.ts';
const layer=(locked=false)=>({...newPaintLayer(),locked,strokes:[{tool:'pen',points:[{x:1,y:1}],size:2,color:'#000'}]});
const owner=(layers)=>({key:'figure-0',kind:'figure',paint:{layers},figure:{}});
test('locked layers reject content and property changes, while allowing visibility and unlocking',()=>{
 const l=layer(true),o=owner([l]);
 for(const patch of [{opacity:.2},{blend:'multiply'},{paths:[]},{strokes:[]},{name:'renamed'},{locked:false,opacity:.3},{mask:{enabled:false}}])assert.equal(paintLayerPatchAllowed(o,l,patch),false);
 for(const patch of [{locked:false},{visible:false},{locked:false,visible:true}])assert.equal(paintLayerPatchAllowed(o,l,patch),true);
 assert.equal(paintLayerEditable(o,l),false);assert.equal(paintLayerPatchAllowed(o,l,{}),false);
});
test('an explicit owner lock stays independent and cannot be bypassed by unlocking a child',()=>{
 const l=layer(),o=owner([l]);o.figure.artwork={locked:true};
 assert.equal(paintLayerEditable(o,l),false);assert.equal(paintLayerPatchAllowed(o,l,{locked:false}),false);
 assert.equal(paintLayerPatchAllowed(o,l,{visible:false}),true);assert.equal(paintOwnerPlacementLocked(o),true);
});
test('locked source content does not lock an owner with editable foreground content',()=>{
 const source=layer(true),foreground=layer(),o=owner([source,foreground]);
 assert.equal(paintContentsLocked(o.paint),false);assert.equal(paintOwnerPlacementLocked(o),false);assert.equal(paintLayerEditable(o,foreground),true);
 foreground.locked=true;assert.equal(paintOwnerPlacementLocked(o),true);
});
test('blank, hidden and zero-opacity children do not make wholly locked artwork movable',()=>{
 const source=layer(true),blank=newPaintLayer(),hidden={...layer(),visible:false},zero={...layer(),opacity:0};
 assert.equal(paintContentsLocked({layers:[source,blank,hidden,zero]}),true);
 assert.equal(artworkLocked({paint:{layers:[source,blank]}}),true);
 assert.equal(paintContentsLocked({layers:[blank]}),false);assert.equal(artworkLocked(undefined),false);
});
