// Public landing-page preview only: no billing database, sessions, API keys or Torn calls.
const http=require('node:http');
const {serveSite}=require('../premium/site');
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://preview.local');
  let pathname=url.pathname;
  if(pathname==='/torn-premium')pathname='/';
  else if(pathname.startsWith('/torn-premium/'))pathname=pathname.slice('/torn-premium'.length);
  if(!serveSite(req,res,pathname)){res.writeHead(404);res.end('Not found');}
});
server.listen(4848,'127.0.0.1',()=>console.log('Landing preview: http://127.0.0.1:4848/torn-premium'));
