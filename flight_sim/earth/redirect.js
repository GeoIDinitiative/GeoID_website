// Earth Flight lives inside GeoHUB now: the shared flight mode on the Earth
// globe (Explorer > Earth Flight). This old address bounces there, carrying a
// place if it was given one, the way the standalone planet viewers bounce to
// /?world=<id>. Validated before it is forwarded; nothing else is carried.
(function () {
  var q = new URLSearchParams(window.location.search);
  var out = "/?flight=earth";
  var lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (q.has("lat") && q.has("lon") && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
    out += "&lat=" + lat.toFixed(5) + "&lon=" + lon.toFixed(5);
  }
  window.location.replace(out);
})();
