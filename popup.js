/*
  Copyright 2017 Craig Miskell

  This file is part of CookieMaster, a Firefox Web Extension 
  CookieMaster is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  CookieMaster is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>. 
*/

async function saveConfig(config) {
  await browser.storage.local.set({
    thirdParty: config.thirdParty,
    allowList: config.allowList
  });
  await browser.runtime.sendMessage({"name": "configChanged"}) 
}

async function addException(domain) {
  var config = await getConfig();
  var d = domain;
  if(!domain.startsWith('.')) {
    d = "."+domain;
  }
  config.allowList.push(domain);
  await saveConfig(config);
}

async function removeException(domain) {
  var config = await getConfig();
  var index = config.allowList.indexOf(domain);
  if(index >= 0) {
    config.allowList.splice(index,1);
  }
  await saveConfig(config);
}

async function toggleException(checkbox, domain) {
  //checkbox.checked is the *new* state, after the change 
  var label = checkbox.nextSibling;
  var domainSpan = label.nextElementSibling;
/*  if(label.classList.contains('outofstate')) {
    label.classList.remove('outofstate');
    domainSpan.classList.remove('outofstate');
  } else {
    label.classList.add('outofstate');
    domainSpan.classList.add('outofstate');
  }*/
  if(checkbox.checked) {
    //Is checked, was not checked before: want to allow, so add an exception
    await addException(domain); 
  } else {
    //Not checked, was before; want to block this domain, so remove any exceptions
    await removeException(domain);
  }
  //Force the re-rendering
  render(true);
}

function onCheckboxChange(e) {
  if(e.target.checked) {
    e.target.cookieList[e.target.domain] = 1;
  } else {
    delete e.target.cookieList[e.target.domain];
  }
  e.target.button.disabled = (Object.keys(e.target.cookieList).length == 0) 
}

function clearDiv(divName) {
  var oldDiv = document.getElementById(divName);
  var div = document.createElement('div');
  div.id = divName;
  oldDiv.parentNode.replaceChild(div, oldDiv); 
}

function displayCookieList(options) {
  var text = options.text;
  var divName = options.divName;
  var cookieDomains = options.cookieDomains;
  var config = options.config;
  var action = options.action;
  var showToggle = options.hasOwnProperty('showToggle') ? options.showToggle : true;

  var cookieDomainKeys = Object.keys(cookieDomains).sort(compareDomains);

  //Replace the div with an empty one as a quick way to nerf any children.
  clearDiv(divName);

  var div = document.getElementById(divName);

  if(cookieDomainKeys.length > 0) {
    var fragment = document.createDocumentFragment();
    var title = document.createElement('div');
    title.textContent = text; 
    title.style = "font-weight: bold;";
    fragment.appendChild(title);
    for(var configDomain of cookieDomainKeys) {
      for (var d of Object.keys(cookieDomains[configDomain]).sort(compareDomains)) {
        var domainNameSpan = document.createElement('span');
        if(showToggle) {
          createToggle(fragment, config, action, d, domainNameSpan);
        }
        domainNameSpan.textContent = d;
        fragment.appendChild(domainNameSpan)
        fragment.appendChild(document.createElement('br'));
      }
    }
    div.appendChild(fragment);
  }
}

function createToggle(container, config, cookieAction, domain, domainNameSpan) {
  //NB: Check the CSS for the input/label/i behaviour; TL;DR: checkbox is invisible, the label is 
  // clickable (htmlFor), and the 'i' is the toggle button. End result is (misc attribs elided for brevity): 
  // <input id="foo"><label for="foo"><i></i></label> <span>$DOMAIN</span>
  var checked = domainInList(config, domain);
  var configDomain = domainIsAllowed(config, domain);
  var implied = configDomain && (domain.length > configDomain.length);

  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.id = 'toggle-' + domain; 
  checkbox.addEventListener('change', toggleException.bind(null, checkbox, domain)); 
  container.appendChild(checkbox);
  
  var label = document.createElement('label');
  label.htmlFor = 'toggle-' + domain; //Vital, otherwise clicks of the label don't get sent to the checkbox

  //Implied domains can never be out of state.
  var outofstate = implied ? 
      false : 
      (cookieAction == CookieActions.Allowed && !checked) || (cookieAction== CookieActions.Blocked && checked);

  if(outofstate) {
    label.classList.add('outofstate');
    domainNameSpan.classList.add('outofstate');
  }
  var toggle = document.createElement('i');
  if (implied) {
    //An implied domain needs the toggle + label displayed slightly differently
    toggle.className = 'implied';
    label.classList.add('implied');
  }
  label.appendChild(toggle);
  container.appendChild(label);
  container.appendChild(document.createTextNode(' '));
}

//For use by 'sort', to sort domains by components preceding the public suffix, 
// e.g. in google.com vs microsoft.net, just sorts by google vs microsoft.
// Produces a more natural looking sorting, as the sld is typically the organisation that
// matters
function compareDomains(a, b) {
  var aParsed = psl.parse(a.startsWith('.') ? a.substring(1) : a);
  var bParsed = psl.parse(b.startsWith('.') ? b.substring(1) : b);

  var abits = aParsed.subdomain ? aParsed.subdomain.split('.').reverse() : [];
  var bbits = bParsed.subdomain ? bParsed.subdomain.split('.').reverse() : [];

  if(aParsed.sld) {
    abits.unshift(aParsed.sld);
  }
  if(bParsed.sld) {
    bbits.unshift(bParsed.sld);
  }

  for(var i = 0; i < Math.min(abits.length, bbits.length); i++) {
    if(abits[i] == bbits[i]) {
      continue;
    }
    return abits[i].localeCompare(bbits[i]);
  }
  //One is a suffix of the other (www.google.com vs google.com), so longer sorts after shorter.
  return abits.length - bbits.length;
}

function categoriseCookies(cookieHash, hostname) {
  var firstParty = {};
  var thirdParty = {};
  for (var d of Object.keys(cookieHash)) {
    if(hostname.endsWith(d)) {
      firstParty[d] = cookieHash[d];
    } else {
      thirdParty[d] = cookieHash[d];
    }
  }
  return {
    'firstParty': firstParty,
    'thirdParty': thirdParty,
  }
}

function collectOtherCookies(hostname, tabInfo, domains) {
  var firstParty = {
    allowed: [],
    blocked: [],
  };
  var thirdParty = {
    allowed: [],
    blocked: [],
  };

  for (var fetched of Object.keys(tabInfo.domainsFetched)) {
    for (var cookieDomain of Object.keys(domains)) {
      if (fetched.endsWith(cookieDomain)) {
        var domainInfo = domains[cookieDomain];
        for(var action of ['blocked', 'allowed']) {
          if(action in domainInfo) {
            var targetHash = hostname.endsWith(cookieDomain) ? firstParty : thirdParty;
            //Only include cookies that have been updated *since* this tabInfo was created.
            // Otherwise we notice cookies blocked/allowed from previous page-loads, potentially
            // before we changed the allow/deny state for a domain, which is pants
            var allCookies = domainInfo[action];
            var filteredCookies = { };
            for(var d of Object.keys(allCookies)) {
              if(allCookies[d] >= tabInfo.created) {
                filteredCookies[d] = allCookies[d];
              }
            }
            if(Object.keys(filteredCookies).length > 0) {
              targetHash[action][cookieDomain] = filteredCookies; 
            }
          }
        }
      }
    }
  }
  return {
    'firstParty': firstParty,
    'thirdParty': thirdParty,
  }
}

function mergeCookieLists(a, b) {
  var result = {};
  for (var aKey of Object.keys(a)) {
    if(aKey in b) {
      //aKey is in both a and b; merge the dictionaries 
      result[aKey] = Object.assign({}, a[aKey], b[aKey]);
    } else {
      result[aKey] = a[aKey];
    }
  }
  for(var bKey of Object.keys(b)) {
    if(!(bKey in result)) {
      //bKey wasn't in a, so wasn't merged; jam it in
      result[bKey] = b[bKey];
    }
  }
  return result;
}

//Temporary, until we confirm new UI, and revert data collection to just cookie domain
// and stop caring which configured domain allowed it. Maybe?
function cookieInHash(hash, domain) {
  for (var d of Object.keys(hash)) {
    if(domain.endsWith(d)) {
      for(var cd of Object.keys(hash[d])) {
        if ((cd == domain) || (cd == "."+domain)) {
          return true;
        }
      } 
    }
  }
  return false;
}

//Blech.  Alternatives accepted
var thirdPartySectionGenerated = false;
var thirdPartySectionGenerateFunction;
var lastUpdated = 0;
var rendering = false;

async function render(force = false) {
  if(rendering) {
    return;
  }
  rendering = true;
  thirdPartySectionGenerated = false;
  var config = await getConfig();

  var bg = await browser.runtime.getBackgroundPage();

  var tabs = await browser.tabs.query({active: true, currentWindow: true});
  var tab = tabs[0];
  var tabInfo = bg.tabsInfo[tab.id];

  if(!tab.url.startsWith('http')) {
    document.body.innerHTML = "<em>Not an HTTP(S) page</em>";
    return;
  }

  var hostnameContainer = document.getElementById('hostname');
  var hostname = new URL(tab.url).hostname
  hostnameContainer.innerText = hostname; 

  if(!force) {
    if(!tabInfo) {
      document.getElementById('primaryCookies').innerText = "Unknown";
      rendering = false;
      return;
    }
    if((tabInfo.updated < lastUpdated && bg.domains.updated < lastUpdated)) {
      //Nothing has changed; no need to redisplay anything
      rendering = false;
      return;
    }
  }
  lastUpdated = Date.now();
  var allowedObj = categoriseCookies(tabInfo.cookieDomainsAllowed, hostname);
  var blockedObj = categoriseCookies(tabInfo.cookieDomainsBlocked, hostname);
  var otherCookies = collectOtherCookies(hostname, tabInfo, bg.domains);
  /*console.log(allowedObj);
  console.log(blockedObj);
  console.log(otherCookies);
*/
  var parsedHostname = psl.parse(hostname);
  var domainComponents = []
  domainComponents.push(parsedHostname.sld);
  if(parsedHostname.subdomain) {
    domainComponents = domainComponents.concat(parsedHostname.subdomain.split('.').reverse());
  }
  
  clearDiv('primaryCookies');
  var fragment = document.createDocumentFragment();

  var partDomain = parsedHostname.tld;
  for(var dc of domainComponents) {
    partDomain = dc + "." + partDomain;
    var icon = document.createElement('img');  
    var action = CookieActions.Unset;
    if(cookieInHash(allowedObj.firstParty, partDomain) || cookieInHash(otherCookies.firstParty.allowed, partDomain)) {
      icon.src = "icons/cookies-allowed-32.png";
      action = CookieActions.Allowed; 
    } else if (cookieInHash(blockedObj.firstParty, partDomain) || cookieInHash(otherCookies.firstParty.blocked, partDomain)) {
      icon.src = "icons/cookies-blocked-32.png";
      action = CookieActions.Blocked;
    } else {
      icon.src = "icons/blank.png"; 
    }
    icon.height = 16;
    icon.width = 16;
    fragment.appendChild(icon);
    fragment.appendChild(document.createTextNode(' '));
    var domainNameSpan = document.createElement('span');
    createToggle(fragment, config, action, partDomain, domainNameSpan);
    domainNameSpan.textContent = partDomain;
    fragment.appendChild(domainNameSpan);  
    fragment.appendChild(document.createElement('br'));
  }
  var div = document.getElementById('primaryCookies');
  div.appendChild(fragment);


  //Easier to have this be a closure than to extract it out to it's own method which will need to allll
  // the general setup (e.g. getting 'config', and the cookie lists);
  // Possibly only marginal usefulness though; the cookie collation may take longer than the DOM generation
  // But this makes me feel good, so why not?! 
  thirdPartySectionGenerateFunction = function() {
    displayCookieList({
      text: "Allowed"+(config.thirdParty == ThirdPartyOptions.AllowAll ? " (all, by policy)" : ""), 
      divName: 'allowedThirdPartyCookies',
      cookieDomains: mergeCookieLists(allowedObj.thirdParty, otherCookies.thirdParty.allowed),
      config: config,
      action: CookieActions.Allowed, 
      showToggle: (config.thirdParty == ThirdPartyOptions.AllowIfOtherwiseAllowed),
    });

    displayCookieList({
      text: "Blocked"+(config.thirdParty == ThirdPartyOptions.AllowNone ? " (all, by policy)" : ""), 
      divName: 'blockedThirdPartyCookies',
      cookieDomains: mergeCookieLists(blockedObj.thirdParty, otherCookies.thirdParty.blocked),
      config: config,
      action: CookieActions.Blocked, 
      showToggle: (config.thirdParty == ThirdPartyOptions.AllowIfOtherwiseAllowed),
    });

    if((allowedObj.thirdParty.length == 0) && (blockedObj.thirdParty.length == 0)) {
      document.getElementById('thirdPartyWrapper').innerHTML="No third-party cookies";
    }
  }
  //Immediately (re-)render the thirdparty cookie section if it was previously open
  if(document.getElementById('thirdPartyWrapper').style.display != 'none') {
    thirdPartySectionGenerated = true
    thirdPartySectionGenerateFunction();
  }
  rendering = false;
}

async function contentLoaded() {
  document.getElementById('helplink').href = browser.extension.getURL("help.html");
  render();
  document.getElementById('thirdPartyTitle').addEventListener('click', toggleThirdParty);
  window.setInterval(render, 500); 
}

function toggleThirdParty(e) {
  if(!thirdPartySectionGenerated) {
    thirdPartySectionGenerated = true
    thirdPartySectionGenerateFunction();
  }

  var el = document.getElementById('thirdPartyWrapper');
  var currVal = el.style.display;
  el.style.display = (currVal == 'block' ? 'none' : 'block');

  var img = document.getElementById('thirdPartyArrow')
  var newDir = (currVal == 'block' ? 'right' : 'down');
  img.src="../icons/arrow-"+newDir+".png";
    
}


document.addEventListener('DOMContentLoaded', contentLoaded);
