const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseProfile,handler}=require('../netlify/functions/steam-library');
test('accepts Steam IDs and vanity paths; rejects external hosts and paths',()=>{
  assert.equal(parseProfile('https://steamcommunity.com/profiles/76561198000000000/').kind,'profiles');
  assert.equal(parseProfile('https://steamcommunity.com/id/test').value,'test');
  for(const url of ['https://evil.test/id/test','https://steamcommunity.com.evil.test/id/test','https://steamcommunity.com/id/test/games','http://steamcommunity.com/id/test'])assert.throws(()=>parseProfile(url));
});
test('library endpoint authenticates, resolves vanity and preserves more than 100 games',async()=>{
  const prior=global.fetch,key=process.env.STEAM_WEB_API_KEY;
  process.env.STEAM_WEB_API_KEY='test-secret';let calls=[];
  global.fetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>String(url).includes('accounts:lookup')?{users:[{localId:'test'}]}:String(url).includes('ResolveVanityURL')?{response:{success:1,steamid:'76561198000000000'}}:{response:{game_count:150,games:Array.from({length:150},(_,i)=>({appid:i+1,name:`Game ${i}`,playtime_forever:42}))}}};};
  try{
    const request={httpMethod:'POST',headers:{authorization:'Bearer test.token'},body:JSON.stringify({profile:'https://steamcommunity.com/id/test'})};
    const result=await handler(request);assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).games.length,150);assert.equal(JSON.parse(result.body).games[0].minutes,42);assert.equal(calls.length,3);assert.ok(!result.body.includes('test-secret'));
    assert.equal((await handler({...request,headers:{}})).statusCode,401);
    global.fetch=async url=>({ok:true,json:async()=>String(url).includes('accounts:lookup')?{users:[{}]}:{response:{}}});
    const privateResult=await handler({...request,body:JSON.stringify({profile:'https://steamcommunity.com/profiles/76561198000000000'})});assert.equal(privateResult.statusCode,403);
  }finally{global.fetch=prior;if(key===undefined)delete process.env.STEAM_WEB_API_KEY;else process.env.STEAM_WEB_API_KEY=key;}
});
