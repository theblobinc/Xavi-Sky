<?php
namespace Concrete\Package\XaviSky\Controller\Api;
defined('C5_EXECUTE') or die('Access Denied.');

use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class Sky
{
    const DB='/datastore3/xavi-sky/data/xavi-sky.sqlite';

    private static function out($x,$s=200){ return new JsonResponse($x,$s,['Cache-Control'=>'no-store']); }
    private static function registered(){ $u=new User(); return $u->isRegistered(); }
    private static function db(){
        $d=new \PDO('sqlite:'.self::DB);
        $d->setAttribute(\PDO::ATTR_ERRMODE,\PDO::ERRMODE_EXCEPTION);
        $d->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE,\PDO::FETCH_ASSOC);
        $d->exec('PRAGMA busy_timeout=5000');
        return $d;
    }

    public static function status(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        try{
            $d=self::db();
            $one=function($sql)use($d){ return (int)$d->query($sql)->fetchColumn(); };
            $run=$d->query("SELECT * FROM runs ORDER BY COALESCE(finished_at,started_at) DESC LIMIT 1")->fetch()?:null;
            return self::out([
                'ok'=>true,
                'mode'=>'discovery-only',
                'manualFollowOnly'=>true,
                'candidateCount'=>$one('SELECT COUNT(*) FROM candidates'),
                'starterPackCount'=>$one('SELECT COUNT(*) FROM starter_packs'),
                'eventCount'=>$one('SELECT COUNT(*) FROM events'),
                'nodeCount'=>$one('SELECT COUNT(*) FROM nodes'),
                'accountStateCount'=>$one('SELECT COUNT(*) FROM account_state'),
                'followedCount'=>$one("SELECT COUNT(*) FROM account_state WHERE state='followed'"),
                'dismissedCount'=>$one("SELECT COUNT(*) FROM account_state WHERE state='dismissed'"),
                'snoozedCount'=>$one("SELECT COUNT(*) FROM account_state WHERE state='snoozed' AND detail>strftime('%Y-%m-%dT%H:%M:%fZ','now')"),
                'lastRun'=>$run,
                'db'=>self::DB,
            ]);
        }catch(\Throwable $e){ return self::out(['error'=>$e->getMessage()],500); }
    }

    public static function nodes(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        $d=self::db();
        return self::out(['nodes'=>$d->query("SELECT n.*, (SELECT COUNT(*) FROM events e WHERE e.origin_node=n.node_id) event_count FROM nodes n ORDER BY last_seen_at DESC")->fetchAll()]);
    }

    public static function events(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        $r=Request::createFromGlobals();
        $limit=max(1,min(500,(int)$r->query->get('limit',120)));
        $d=self::db();
        $st=$d->prepare('SELECT ingest_seq,event_id,origin_node,event_type,entity_type,entity_id,account_handle,payload_json,created_at FROM events ORDER BY ingest_seq DESC LIMIT ?');
        $st->bindValue(1,$limit,\PDO::PARAM_INT); $st->execute();
        return self::out(['events'=>$st->fetchAll()]);
    }

    public static function candidates(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        $r=Request::createFromGlobals();
        $limit=max(1,min(1000,(int)$r->query->get('limit',400)));
        $q=trim((string)$r->query->get('q',''));
        $sort=(string)$r->query->get('sort','score');
        $order=$sort==='followers'?'COALESCE(c.followers_count,0) DESC,c.score DESC':($sort==='recent'?'c.last_seen_at DESC,c.score DESC':'c.score DESC,COALESCE(c.followers_count,0) DESC');
        $d=self::db();
        $sql="SELECT c.*, (SELECT json_group_object(account_handle,state) FROM account_state a WHERE a.did=c.did) account_states FROM candidates c";
        $params=[];
        if($q!==''){ $sql.=' WHERE c.handle LIKE :q OR c.display_name LIKE :q OR c.description LIKE :q OR COALESCE(c.rationale,\'\') LIKE :q'; $params[':q']='%'.$q.'%'; }
        $sql.=' ORDER BY '.$order.' LIMIT :lim';
        $st=$d->prepare($sql);
        foreach($params as $k=>$v) $st->bindValue($k,$v,\PDO::PARAM_STR);
        $st->bindValue(':lim',$limit,\PDO::PARAM_INT); $st->execute();
        return self::out(['candidates'=>$st->fetchAll(),'limit'=>$limit,'sort'=>$sort]);
    }

    public static function starterPacks(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        $d=self::db();
        return self::out(['starterPacks'=>$d->query('SELECT * FROM starter_packs ORDER BY last_seen_at DESC LIMIT 500')->fetchAll()]);
    }

    public static function followQueue(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        $r=Request::createFromGlobals();
        $account=strtolower(trim((string)$r->query->get('account','')));
        if($account==='') return self::out(['error'=>'account required'],400);
        $limit=max(1,min(250,(int)$r->query->get('limit',100)));
        $q=trim((string)$r->query->get('q',''));
        $theme=trim((string)$r->query->get('theme',''));
        $minFollowers=max(0,min(100000000,(int)$r->query->get('minFollowers',0)));
        $sort=(string)$r->query->get('sort','score');
        $order=$sort==='followers'?'COALESCE(c.followers_count,0) DESC,c.score DESC':($sort==='recent'?'c.last_seen_at DESC,c.score DESC':($sort==='activity'?'COALESCE(c.posts_count,0) DESC,c.score DESC':'c.score DESC,COALESCE(c.followers_count,0) DESC'));
        $now=(new \DateTimeImmutable('now',new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
        $d=self::db();
        $sql="SELECT c.*, a.state account_state,a.detail account_detail,a.last_action_at account_last_action
              FROM candidates c
              LEFT JOIN account_state a ON a.did=c.did AND a.account_handle=:account
              WHERE (a.state IS NULL OR (a.state NOT IN ('followed','dismissed') AND NOT (a.state='snoozed' AND a.detail>:now)))
                AND COALESCE(c.followers_count,0)>=:minFollowers
                AND c.themes_json NOT LIKE '%\"followback\"%'";
        if($q!=='') $sql.=" AND (c.handle LIKE :q OR c.display_name LIKE :q OR c.description LIKE :q OR COALESCE(c.rationale,'') LIKE :q)";
        if($theme!=='') $sql.=" AND c.themes_json LIKE :theme";
        $sql.=' ORDER BY '.$order.' LIMIT :lim';
        $st=$d->prepare($sql);
        $st->bindValue(':account',$account,\PDO::PARAM_STR);
        $st->bindValue(':now',$now,\PDO::PARAM_STR);
        $st->bindValue(':minFollowers',$minFollowers,\PDO::PARAM_INT);
        if($q!=='') $st->bindValue(':q','%'.$q.'%',\PDO::PARAM_STR);
        if($theme!=='') $st->bindValue(':theme','%"'.$theme.'"%',\PDO::PARAM_STR);
        $st->bindValue(':lim',$limit,\PDO::PARAM_INT); $st->execute();
        return self::out(['account'=>$account,'queue'=>$st->fetchAll(),'limit'=>$limit,'q'=>$q,'theme'=>$theme,'minFollowers'=>$minFollowers,'sort'=>$sort]);
    }

    public static function reviewHistory(){
        if(!self::registered()) return self::out(['error'=>'auth'],401);
        $r=Request::createFromGlobals();
        $account=strtolower(trim((string)$r->query->get('account','')));
        if($account==='') return self::out(['error'=>'account required'],400);
        $limit=max(1,min(500,(int)$r->query->get('limit',200)));
        $d=self::db();
        $st=$d->prepare("SELECT a.account_handle,a.did,a.state,a.detail,a.last_action_at,c.handle,c.display_name,c.description,c.followers_count,c.posts_count,c.score,c.themes_json,c.sources_json,c.rationale,c.score_breakdown_json
                         FROM account_state a LEFT JOIN candidates c ON c.did=a.did
                         WHERE a.account_handle=? ORDER BY COALESCE(a.last_action_at,'') DESC LIMIT ?");
        $st->bindValue(1,$account,\PDO::PARAM_STR); $st->bindValue(2,$limit,\PDO::PARAM_INT); $st->execute();
        return self::out(['account'=>$account,'history'=>$st->fetchAll(),'limit'=>$limit]);
    }
}
