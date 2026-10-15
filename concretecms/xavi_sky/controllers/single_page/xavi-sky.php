<?php
namespace Concrete\Package\XaviSky\Controller\SinglePage;
defined('C5_EXECUTE') or die('Access Denied.');
use Concrete\Core\Page\Controller\PageController;
use Concrete\Core\Page\Page;
use Concrete\Core\User\User;
use Symfony\Component\HttpFoundation\RedirectResponse;
class XaviSky extends PageController {
    public function view(){
        $page=Page::getByPath('/xavi-sky');
        $user=new User();
        if(!$user->isRegistered()) return new RedirectResponse('/login?rcID='.(int)$page->getCollectionID());
    }
}
