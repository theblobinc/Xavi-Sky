<?php
namespace Concrete\Package\XaviSky;
defined('C5_EXECUTE') or die('Access Denied.');
use Concrete\Core\Package\Package;
use Concrete\Core\Page\Page;
use Concrete\Core\Page\Single as SinglePage;
use Concrete\Core\Routing\Router;
use Concrete\Core\Support\Facade\Database;
class Controller extends Package {
 protected $pkgHandle='xavi_sky'; protected $appVersionRequired='9.0.0'; protected $pkgVersion='0.2.4';
 public function getPackageName(){return t('Xavi-Sky');}
 public function getPackageDescription(){return t('Federated Bluesky discovery, ranking, dedupe and worker observability.');}
 public function install(){ $pkg=parent::install(); $this->ensure($pkg); return $pkg; }
 public function upgrade(){ parent::upgrade(); $this->ensure(Package::getByHandle($this->pkgHandle)); }
 public function on_start():void { $router=$this->app->make(Router::class); require __DIR__.'/routes.php'; }
 private function ensure($pkg):void { $p=Page::getByPath('/xavi-sky'); if(!$p||$p->isError())$p=SinglePage::add('/xavi-sky',$pkg); if($p&&!$p->isError()){ $p->update(['cName'=>'Xavi-Sky','cFilename'=>'/xavi-sky.php']); $db=Database::connection(); $db->executeStatement("UPDATE Pages SET cInheritPermissionsFromCID=1, cInheritPermissionsFrom='PARENT', cOverrideTemplatePermissions=1 WHERE cID=?",[(int)$p->getCollectionID()]); $db->executeStatement('DELETE FROM PagePermissionAssignments WHERE cID=?',[(int)$p->getCollectionID()]); } }
}
