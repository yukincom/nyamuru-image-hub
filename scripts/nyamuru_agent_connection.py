"""Read the existing local LLM identity, without starting or switching a model."""
import json
from urllib.request import build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.parse import urlsplit

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def connection_status(endpoint):
    url=urlsplit(endpoint)
    if url.scheme!='http' or url.hostname not in ('127.0.0.1','localhost','::1') or url.username or url.password:
        raise ValueError('ローカルLLMの接続先を確認してください')
    base=f'{url.scheme}://{url.netloc}'
    opener=build_opener(ProxyHandler({}),NoRedirect())
    def read(path):
        with opener.open(base+path,timeout=2) as response:
            raw=response.read(2*1024*1024+1)
        if len(raw)>2*1024*1024:raise ValueError('LLMの応答が長すぎます')
        return json.loads(raw)
    try:
        result=read('/v1/models')
        models=[entry['id'] for entry in result.get('data',[]) if isinstance(entry,dict) and isinstance(entry.get('id'),str) and entry['id']]
        if not models:return {'connected':False,'model':''}
        name=models[0]
        # llama.cpp may expose only the alias "default_model" in /v1/models.
        # Its /props reports the loaded model path; disclose only the basename.
        if name in ('default_model','default'):
            try:
                props=read('/props')
                path=props.get('model_path')
                if isinstance(path,str) and path:name=path
            except (OSError,ValueError,TypeError,AttributeError):pass
        name=name.replace('\\','/').rsplit('/',1)[-1]
        if name.lower().endswith('.gguf'):name=name[:-5]
        return {'connected':True,'model':name[:200]}
    except (OSError,ValueError,TypeError,AttributeError):
        return {'connected':False,'model':''}
