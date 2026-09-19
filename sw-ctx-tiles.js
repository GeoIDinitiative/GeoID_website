// Retired as a worker of its own: the root scope has ONE worker, /sw.js,
// which carries everything this file used to do (the CTX proxy, tile and
// asset caching). Two scripts registered at one scope replace each other on
// every load, and each deleted the other's caches — see the header of
// /sw.js. A page cached from before the change may still register this URL;
// it gets the same code.
importScripts('/sw.js');
