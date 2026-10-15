<?php
namespace Concrete\Package\XaviSky\Controller\Api;
defined('C5_EXECUTE') or die('Access Denied.');

use Concrete\Core\Support\Facade\Application;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class Actions
{
    const DB='/datastore3/xavi-sky/data/xavi-sky.sqlite';
    const ACCOUNTS='/datastore3/xavi-sky/secrets/bluesky-accounts.json';
    const ORIGIN='xavi-sky-prod4-web';

    private static function out($x,$s=200){ return new JsonResponse($x,$s,['Cache-Control'=>'no-store']); }
    private static function registered(){ $u=new User(); return $u->isRegistered(); }
    private static function db(){
        $d=new \PDO('sqlite:'.self::DB);
        $d->setAttribute(\PDO::ATTR_ERRMODE,\PDO::ERRMODE_EXCEPTION);
        $d->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE,\PDO::FETCH_ASSOC);
        $d->exec('PRAGMA busy_timeout=5000');
        return $d;
    }
    private static function csrfOk(Request $r){
        $token=(string)($r->headers->get('X-Xavi-Sky-CSRF') ?: $r->request->get('csrf',''));
        try { return Application::getFacadeApplication()->make('helper/validation/token')->validate('xavi_sky_action',$token); }
        catch(\Throwable $e){ return false; }
    }
    private static function normalizeService($s){
        $s=rtrim(trim((string)$s),'/');
        if($s==='') $s='https://bsky.social';
        if(!preg_match('#^https://[A-Za-z0-9.-]+(?::[0-9]+)?$#',$s)) throw new \RuntimeException('Invalid Bluesky service URL');
        return $s;
    }
    private static function accountsRaw(){
        if(!is_readable(self::ACCOUNTS)) return [];
        $x=json_decode((string)file_get_contents(self::ACCOUNTS),true);
        $rows=is_array($x)&&isset($x['accounts'])&&is_array($x['accounts'])?$x['accounts']:[];
        $out=[];
        foreach($rows as $row){
            if(!is_array($row)) continue;
            $handle=strtolower(trim((string)($row['handle']??'')));
            $password=trim((string)($row['appPassword']??''));
            if($handle===''||$password==='') continue;
            try{$service=self::normalizeService($row['service']??'https://bsky.social');}catch(\Throwable $e){continue;}
            $out[$handle]=['handle'=>$handle,'appPassword'=>$password,'service'=>$service,'did'=>(string)($row['did']??'')];
        }
        return $out;
    }
    public static function accounts(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        $rows=[];
        foreach(self::accountsRaw() as $row) $rows[]=['handle'=>$row['handle'],'service'=>$row['service'],'configured'=>true,'did'=>$row['did']??''];
        return self::out(['accounts'=>$rows,'configured'=>(bool)$rows,'path'=>self::ACCOUNTS]);
    }
    private static function postJson($url,$body,$jwt=null){
        $ch=curl_init($url);
        $headers=['Content-Type: application/json','Accept: application/json'];
        if($jwt) $headers[]='Authorization: Bearer '.$jwt;
        curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,CURLOPT_HTTPHEADER=>$headers,CURLOPT_POSTFIELDS=>json_encode($body,JSON_UNESCAPED_SLASHES)]);
        $raw=curl_exec($ch); $code=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE); $err=curl_error($ch); curl_close($ch);
        $json=is_string($raw)?json_decode($raw,true):null;
        if($raw===false||$code<200||$code>=300){
            $msg=is_array($json)?(string)($json['message']??$json['error']??''):$err;
            throw new \RuntimeException('Bluesky HTTP '.$code.($msg!==''?': '.$msg:''));
        }
        return is_array($json)?$json:[];
    }
    private static function createSession($row){
        $session=self::postJson($row['service'].'/xrpc/com.atproto.server.createSession',['identifier'=>$row['handle'],'password'=>$row['appPassword']]);
        if(empty($session['accessJwt'])||empty($session['did'])) throw new \RuntimeException('Bluesky session response incomplete');
        return $session;
    }
    public static function saveAccounts(){
        $r=Request::createFromGlobals();
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        if(!self::csrfOk($r)) return self::out(['error'=>'csrf'],403);
        $body=json_decode((string)$r->getContent(),true);
        $rows=is_array($body)&&isset($body['accounts'])&&is_array($body['accounts'])?$body['accounts']:[];
        if(!$rows||count($rows)>8) return self::out(['error'=>'Provide 1-8 Bluesky accounts'],400);
        $existing=self::accountsRaw(); $saved=[]; $public=[];
        try{
            foreach($rows as $in){
                if(!is_array($in)) throw new \RuntimeException('Invalid account row');
                $handle=strtolower(trim((string)($in['handle']??'')));
                if(!preg_match('/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/',$handle)) throw new \RuntimeException('Invalid Bluesky handle');
                $service=self::normalizeService($in['service']??'https://bsky.social');
                $password=trim((string)($in['appPassword']??''));
                if($password===''&&isset($existing[$handle])) $password=$existing[$handle]['appPassword'];
                if($password==='') throw new \RuntimeException('Missing app password for '.$handle);
                $row=['handle'=>$handle,'appPassword'=>$password,'service'=>$service];
                $session=self::createSession($row);
                $row['did']=(string)$session['did'];
                $saved[]=$row;
                $public[]=['handle'=>$handle,'service'=>$service,'configured'=>true,'did'=>$row['did'],'validated'=>true];
            }
            $dir=dirname(self::ACCOUNTS);
            if(!is_dir($dir)&&!mkdir($dir,0770,true)) throw new \RuntimeException('Unable to create secret directory');
            $tmp=self::ACCOUNTS.'.tmp.'.bin2hex(random_bytes(4));
            $payload=json_encode(['accounts'=>$saved],JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n";
            if(file_put_contents($tmp,$payload,LOCK_EX)===false) throw new \RuntimeException('Unable to write secret file');
            @chmod($tmp,0640);
            if(!rename($tmp,self::ACCOUNTS)){ @unlink($tmp); throw new \RuntimeException('Unable to install secret file'); }
            @chmod(self::ACCOUNTS,0640);
            return self::out(['ok'=>true,'accounts'=>$public,'count'=>count($public)]);
        }catch(\Throwable $e){ return self::out(['error'=>$e->getMessage()],400); }
    }
    private static function nextOriginSeq($d){
        $key='origin_seq:'.self::ORIGIN;
        $st=$d->prepare('SELECT value FROM meta WHERE key=?');$st->execute([$key]);$prev=(int)($st->fetchColumn()?:0);
        $n=max($prev+1,(int)(microtime(true)*1000000));
        $st=$d->prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');$st->execute([$key,(string)$n]);
        return $n;
    }
    private static function emitAccountState($d,$handle,$did,$state,$detail,$at){
        $eventId=self::ORIGIN.'-'.bin2hex(random_bytes(12)); $seq=self::nextOriginSeq($d);
        $payload=json_encode(['state'=>$state,'detail'=>$detail,'at'=>$at],JSON_UNESCAPED_SLASHES);
        $st=$d->prepare('INSERT INTO events(event_id,origin_node,origin_seq,event_type,entity_type,entity_id,account_handle,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
        $st->execute([$eventId,self::ORIGIN,$seq,'account.state','actor',$did,$handle,$payload,$at]);
        $st=$d->prepare("INSERT INTO account_state(account_handle,did,state,detail,last_event_id,last_action_at) VALUES(?,?,?,?,?,?) ON CONFLICT(account_handle,did) DO UPDATE SET state=excluded.state,detail=excluded.detail,last_event_id=excluded.last_event_id,last_action_at=excluded.last_action_at WHERE excluded.last_action_at >= COALESCE(account_state.last_action_at,'')");
        $st->execute([$handle,$did,$state,$detail,$eventId,$at]);
    }
    public static function review(){
        $r=Request::createFromGlobals();
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        if(!self::csrfOk($r)) return self::out(['error'=>'csrf'],403);
        $body=json_decode((string)$r->getContent(),true)?:[];
        $handle=strtolower(trim((string)($body['accountHandle']??$body['account_handle']??'')));
        $did=trim((string)($body['did']??''));
        $action=strtolower(trim((string)($body['action']??'')));
        if($handle===''||!preg_match('/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/',$did)) return self::out(['error'=>'accountHandle and valid DID required'],400);
        $accounts=self::accountsRaw(); if(!isset($accounts[$handle])) return self::out(['error'=>'Bluesky account not configured'],409);
        $at=(new \DateTimeImmutable('now',new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
        $state=''; $detail='';
        if($action==='dismiss'){ $state='dismissed'; $detail='manual'; }
        elseif($action==='snooze'){
            $days=max(1,min(90,(int)($body['days']??7)));
            $until=(new \DateTimeImmutable('now',new \DateTimeZone('UTC')))->modify('+'.$days.' days');
            $state='snoozed'; $detail=$until->format('Y-m-d\TH:i:s.v\Z');
        }
        elseif($action==='queue'||$action==='restore'){ $state='queued'; $detail=''; }
        else return self::out(['error'=>'action must be dismiss, snooze, or queue'],400);
        try{
            $d=self::db(); self::emitAccountState($d,$handle,$did,$state,$detail,$at);
            return self::out(['ok'=>true,'accountHandle'=>$handle,'did'=>$did,'state'=>$state,'detail'=>$detail]);
        }catch(\Throwable $e){ return self::out(['error'=>$e->getMessage()],500); }
    }
    public static function follow(){
        $r=Request::createFromGlobals();
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        if(!self::csrfOk($r)) return self::out(['error'=>'csrf'],403);
        $body=json_decode((string)$r->getContent(),true)?:[];
        if(($body['manual']??false)!==true) return self::out(['error'=>'manual confirmation required'],409);
        $handle=strtolower(trim((string)($body['accountHandle']??$body['account_handle']??''))); $did=trim((string)($body['did']??''));
        if($handle===''||!preg_match('/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/',$did)) return self::out(['error'=>'accountHandle and valid DID required'],400);
        $accounts=self::accountsRaw(); if(!isset($accounts[$handle])) return self::out(['error'=>'Bluesky account not configured'],409);
        try{
            $d=self::db();
            $st=$d->prepare('SELECT state,detail,last_action_at FROM account_state WHERE account_handle=? AND did=?');$st->execute([$handle,$did]);$existing=$st->fetch();
            if($existing&&$existing['state']==='followed') return self::out(['ok'=>true,'already'=>true,'state'=>$existing]);
            $session=self::createSession($accounts[$handle]);
            $at=(new \DateTimeImmutable('now',new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
            $rec=self::postJson($accounts[$handle]['service'].'/xrpc/com.atproto.repo.createRecord',[
                'repo'=>(string)$session['did'],
                'collection'=>'app.bsky.graph.follow',
                'record'=>['$type'=>'app.bsky.graph.follow','subject'=>$did,'createdAt'=>$at]
            ],(string)$session['accessJwt']);
            $uri=(string)($rec['uri']??''); if($uri==='') throw new \RuntimeException('Bluesky did not return a follow record URI');
            self::emitAccountState($d,$handle,$did,'followed',$uri,$at);
            return self::out(['ok'=>true,'accountHandle'=>$handle,'did'=>$did,'uri'=>$uri,'cid'=>(string)($rec['cid']??'')]);
        }catch(\Throwable $e){ return self::out(['error'=>$e->getMessage()],502); }
    }
}
