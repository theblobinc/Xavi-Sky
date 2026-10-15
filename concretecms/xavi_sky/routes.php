<?php
defined('C5_EXECUTE') or die('Access Denied.');
require_once __DIR__.'/controller/api/Sky.php';
require_once __DIR__.'/controller/api/Actions.php';
$c='\\Concrete\\Package\\XaviSky\\Controller\\Api\\Sky';
$a='\\Concrete\\Package\\XaviSky\\Controller\\Api\\Actions';
$router->get('/api/xavi/sky/status',$c.'::status');
$router->get('/api/xavi/sky/nodes',$c.'::nodes');
$router->get('/api/xavi/sky/events',$c.'::events');
$router->get('/api/xavi/sky/candidates',$c.'::candidates');
$router->get('/api/xavi/sky/starter-packs',$c.'::starterPacks');
$router->get('/api/xavi/sky/accounts',$a.'::accounts');
$router->post('/api/xavi/sky/accounts',$a.'::saveAccounts');
$router->post('/api/xavi/sky/follow',$a.'::follow');
$router->get('/api/xavi/sky/federation/pull',$c.'::federationPull');
$router->post('/api/xavi/sky/federation/push',$c.'::federationPush');
