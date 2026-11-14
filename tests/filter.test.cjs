'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {compile}=require('../src/core/filter.cjs');
test('safe expressions combine numeric/text/tag predicates without executing code',()=>{
 const row={keys:7,rating:15,title:'Signal Noise',tags:['density'],lnRating:null};
 for(const expr of ['keys == 7 && rating >= 10 && rating < 20','title ~ "noise" && hasTag("density")','!(keys == 4) && (rating > 10 || rating < 2)','lnRating != 0','true'])assert.equal(compile(expr)(row),true);
 for(const expr of ['keys == 4','lnRating > 0','hasTag("tech")','title == "noise"'])assert.equal(compile(expr)(row),false);
 for(const expr of ['process.exit()','rating = 7','constructor','hasTag("speed"','keys ==','(keys == 7','keys == 7;','"bad'])assert.throws(()=>compile(expr));
});
