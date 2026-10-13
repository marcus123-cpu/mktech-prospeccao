const {test}=require('node:test');
const assert=require('node:assert/strict');
const {messageId}=require('./message-id');
test('retorno e evento recente compartilham ID canônico',()=>{const canonical='true_6975043690658@lid_3EB0ABC';assert.equal(messageId({id:{_serialized:canonical}}),canonical);assert.equal(messageId({id:{$1:canonical,fromMe:true,remote:'6975043690658@lid',id:'3EB0ABC'}}),canonical);});
test('reconstitui chave completa sem aceitar identificador parcial',()=>{assert.equal(messageId({id:{fromMe:false,remote:'5517990000000@c.us',id:'ABC'}}),'false_5517990000000@c.us_ABC');assert.equal(messageId({id:{id:'ABC'}}),null);assert.equal(messageId(null),null);});
