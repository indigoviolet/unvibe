var Uh=Object.defineProperty;var Wh=(e,n,t)=>n in e?Uh(e,n,{enumerable:!0,configurable:!0,writable:!0,value:t}):e[n]=t;var oo=(e,n,t)=>Wh(e,typeof n!="symbol"?n+"":n,t);function Vh(e,n){for(var t=0;t<n.length;t++){const r=n[t];if(typeof r!="string"&&!Array.isArray(r)){for(const s in r)if(s!=="default"&&!(s in e)){const i=Object.getOwnPropertyDescriptor(r,s);i&&Object.defineProperty(e,s,i.get?i:{enumerable:!0,get:()=>r[s]})}}}return Object.freeze(Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}))}(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))r(s);new MutationObserver(s=>{for(const i of s)if(i.type==="childList")for(const o of i.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&r(o)}).observe(document,{childList:!0,subtree:!0});function t(s){const i={};return s.integrity&&(i.integrity=s.integrity),s.referrerPolicy&&(i.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?i.credentials="include":s.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function r(s){if(s.ep)return;s.ep=!0;const i=t(s);fetch(s.href,i)}})();function Kh(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e}var Pu={exports:{}},Oi={},Mu={exports:{}},G={};/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var vs=Symbol.for("react.element"),_h=Symbol.for("react.portal"),Gh=Symbol.for("react.fragment"),qh=Symbol.for("react.strict_mode"),Qh=Symbol.for("react.profiler"),Zh=Symbol.for("react.provider"),Yh=Symbol.for("react.context"),Xh=Symbol.for("react.forward_ref"),Jh=Symbol.for("react.suspense"),$h=Symbol.for("react.memo"),em=Symbol.for("react.lazy"),bc=Symbol.iterator;function nm(e){return e===null||typeof e!="object"?null:(e=bc&&e[bc]||e["@@iterator"],typeof e=="function"?e:null)}var Bu={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},Du=Object.assign,Fu={};function kr(e,n,t){this.props=e,this.context=n,this.refs=Fu,this.updater=t||Bu}kr.prototype.isReactComponent={};kr.prototype.setState=function(e,n){if(typeof e!="object"&&typeof e!="function"&&e!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,e,n,"setState")};kr.prototype.forceUpdate=function(e){this.updater.enqueueForceUpdate(this,e,"forceUpdate")};function Iu(){}Iu.prototype=kr.prototype;function al(e,n,t){this.props=e,this.context=n,this.refs=Fu,this.updater=t||Bu}var ll=al.prototype=new Iu;ll.constructor=al;Du(ll,kr.prototype);ll.isPureReactComponent=!0;var Cc=Array.isArray,Ou=Object.prototype.hasOwnProperty,cl={current:null},Hu={key:!0,ref:!0,__self:!0,__source:!0};function zu(e,n,t){var r,s={},i=null,o=null;if(n!=null)for(r in n.ref!==void 0&&(o=n.ref),n.key!==void 0&&(i=""+n.key),n)Ou.call(n,r)&&!Hu.hasOwnProperty(r)&&(s[r]=n[r]);var l=arguments.length-2;if(l===1)s.children=t;else if(1<l){for(var c=Array(l),d=0;d<l;d++)c[d]=arguments[d+2];s.children=c}if(e&&e.defaultProps)for(r in l=e.defaultProps,l)s[r]===void 0&&(s[r]=l[r]);return{$$typeof:vs,type:e,key:i,ref:o,props:s,_owner:cl.current}}function tm(e,n){return{$$typeof:vs,type:e.type,key:n,ref:e.ref,props:e.props,_owner:e._owner}}function dl(e){return typeof e=="object"&&e!==null&&e.$$typeof===vs}function rm(e){var n={"=":"=0",":":"=2"};return"$"+e.replace(/[=:]/g,function(t){return n[t]})}var Sc=/\/+/g;function ao(e,n){return typeof e=="object"&&e!==null&&e.key!=null?rm(""+e.key):n.toString(36)}function Zs(e,n,t,r,s){var i=typeof e;(i==="undefined"||i==="boolean")&&(e=null);var o=!1;if(e===null)o=!0;else switch(i){case"string":case"number":o=!0;break;case"object":switch(e.$$typeof){case vs:case _h:o=!0}}if(o)return o=e,s=s(o),e=r===""?"."+ao(o,0):r,Cc(s)?(t="",e!=null&&(t=e.replace(Sc,"$&/")+"/"),Zs(s,n,t,"",function(d){return d})):s!=null&&(dl(s)&&(s=tm(s,t+(!s.key||o&&o.key===s.key?"":(""+s.key).replace(Sc,"$&/")+"/")+e)),n.push(s)),1;if(o=0,r=r===""?".":r+":",Cc(e))for(var l=0;l<e.length;l++){i=e[l];var c=r+ao(i,l);o+=Zs(i,n,t,c,s)}else if(c=nm(e),typeof c=="function")for(e=c.call(e),l=0;!(i=e.next()).done;)i=i.value,c=r+ao(i,l++),o+=Zs(i,n,t,c,s);else if(i==="object")throw n=String(e),Error("Objects are not valid as a React child (found: "+(n==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":n)+"). If you meant to render a collection of children, use an array instead.");return o}function Es(e,n,t){if(e==null)return e;var r=[],s=0;return Zs(e,r,"","",function(i){return n.call(t,i,s++)}),r}function sm(e){if(e._status===-1){var n=e._result;n=n(),n.then(function(t){(e._status===0||e._status===-1)&&(e._status=1,e._result=t)},function(t){(e._status===0||e._status===-1)&&(e._status=2,e._result=t)}),e._status===-1&&(e._status=0,e._result=n)}if(e._status===1)return e._result.default;throw e._result}var Oe={current:null},Ys={transition:null},im={ReactCurrentDispatcher:Oe,ReactCurrentBatchConfig:Ys,ReactCurrentOwner:cl};function Uu(){throw Error("act(...) is not supported in production builds of React.")}G.Children={map:Es,forEach:function(e,n,t){Es(e,function(){n.apply(this,arguments)},t)},count:function(e){var n=0;return Es(e,function(){n++}),n},toArray:function(e){return Es(e,function(n){return n})||[]},only:function(e){if(!dl(e))throw Error("React.Children.only expected to receive a single React element child.");return e}};G.Component=kr;G.Fragment=Gh;G.Profiler=Qh;G.PureComponent=al;G.StrictMode=qh;G.Suspense=Jh;G.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=im;G.act=Uu;G.cloneElement=function(e,n,t){if(e==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+e+".");var r=Du({},e.props),s=e.key,i=e.ref,o=e._owner;if(n!=null){if(n.ref!==void 0&&(i=n.ref,o=cl.current),n.key!==void 0&&(s=""+n.key),e.type&&e.type.defaultProps)var l=e.type.defaultProps;for(c in n)Ou.call(n,c)&&!Hu.hasOwnProperty(c)&&(r[c]=n[c]===void 0&&l!==void 0?l[c]:n[c])}var c=arguments.length-2;if(c===1)r.children=t;else if(1<c){l=Array(c);for(var d=0;d<c;d++)l[d]=arguments[d+2];r.children=l}return{$$typeof:vs,type:e.type,key:s,ref:i,props:r,_owner:o}};G.createContext=function(e){return e={$$typeof:Yh,_currentValue:e,_currentValue2:e,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},e.Provider={$$typeof:Zh,_context:e},e.Consumer=e};G.createElement=zu;G.createFactory=function(e){var n=zu.bind(null,e);return n.type=e,n};G.createRef=function(){return{current:null}};G.forwardRef=function(e){return{$$typeof:Xh,render:e}};G.isValidElement=dl;G.lazy=function(e){return{$$typeof:em,_payload:{_status:-1,_result:e},_init:sm}};G.memo=function(e,n){return{$$typeof:$h,type:e,compare:n===void 0?null:n}};G.startTransition=function(e){var n=Ys.transition;Ys.transition={};try{e()}finally{Ys.transition=n}};G.unstable_act=Uu;G.useCallback=function(e,n){return Oe.current.useCallback(e,n)};G.useContext=function(e){return Oe.current.useContext(e)};G.useDebugValue=function(){};G.useDeferredValue=function(e){return Oe.current.useDeferredValue(e)};G.useEffect=function(e,n){return Oe.current.useEffect(e,n)};G.useId=function(){return Oe.current.useId()};G.useImperativeHandle=function(e,n,t){return Oe.current.useImperativeHandle(e,n,t)};G.useInsertionEffect=function(e,n){return Oe.current.useInsertionEffect(e,n)};G.useLayoutEffect=function(e,n){return Oe.current.useLayoutEffect(e,n)};G.useMemo=function(e,n){return Oe.current.useMemo(e,n)};G.useReducer=function(e,n,t){return Oe.current.useReducer(e,n,t)};G.useRef=function(e){return Oe.current.useRef(e)};G.useState=function(e){return Oe.current.useState(e)};G.useSyncExternalStore=function(e,n,t){return Oe.current.useSyncExternalStore(e,n,t)};G.useTransition=function(){return Oe.current.useTransition()};G.version="18.3.1";Mu.exports=G;var h=Mu.exports;const Gt=Kh(h),om=Vh({__proto__:null,default:Gt},[h]);/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var am=h,lm=Symbol.for("react.element"),cm=Symbol.for("react.fragment"),dm=Object.prototype.hasOwnProperty,um=am.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,fm={key:!0,ref:!0,__self:!0,__source:!0};function Wu(e,n,t){var r,s={},i=null,o=null;t!==void 0&&(i=""+t),n.key!==void 0&&(i=""+n.key),n.ref!==void 0&&(o=n.ref);for(r in n)dm.call(n,r)&&!fm.hasOwnProperty(r)&&(s[r]=n[r]);if(e&&e.defaultProps)for(r in n=e.defaultProps,n)s[r]===void 0&&(s[r]=n[r]);return{$$typeof:lm,type:e,key:i,ref:o,props:s,_owner:um.current}}Oi.Fragment=cm;Oi.jsx=Wu;Oi.jsxs=Wu;Pu.exports=Oi;var a=Pu.exports,Vu={exports:{}},$e={},Ku={exports:{}},_u={};/**
 * @license React
 * scheduler.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */(function(e){function n(B,U){var W=B.length;B.push(U);e:for(;0<W;){var ne=W-1>>>1,fe=B[ne];if(0<s(fe,U))B[ne]=U,B[W]=fe,W=ne;else break e}}function t(B){return B.length===0?null:B[0]}function r(B){if(B.length===0)return null;var U=B[0],W=B.pop();if(W!==U){B[0]=W;e:for(var ne=0,fe=B.length,Me=fe>>>1;ne<Me;){var Ee=2*(ne+1)-1,pn=B[Ee],nn=Ee+1,ze=B[nn];if(0>s(pn,W))nn<fe&&0>s(ze,pn)?(B[ne]=ze,B[nn]=W,ne=nn):(B[ne]=pn,B[Ee]=W,ne=Ee);else if(nn<fe&&0>s(ze,W))B[ne]=ze,B[nn]=W,ne=nn;else break e}}return U}function s(B,U){var W=B.sortIndex-U.sortIndex;return W!==0?W:B.id-U.id}if(typeof performance=="object"&&typeof performance.now=="function"){var i=performance;e.unstable_now=function(){return i.now()}}else{var o=Date,l=o.now();e.unstable_now=function(){return o.now()-l}}var c=[],d=[],u=1,f=null,p=3,A=!1,v=!1,x=!1,w=typeof setTimeout=="function"?setTimeout:null,g=typeof clearTimeout=="function"?clearTimeout:null,m=typeof setImmediate<"u"?setImmediate:null;typeof navigator<"u"&&navigator.scheduling!==void 0&&navigator.scheduling.isInputPending!==void 0&&navigator.scheduling.isInputPending.bind(navigator.scheduling);function k(B){for(var U=t(d);U!==null;){if(U.callback===null)r(d);else if(U.startTime<=B)r(d),U.sortIndex=U.expirationTime,n(c,U);else break;U=t(d)}}function b(B){if(x=!1,k(B),!v)if(t(c)!==null)v=!0,qe(y);else{var U=t(d);U!==null&&z(b,U.startTime-B)}}function y(B,U){v=!1,x&&(x=!1,g(N),N=-1),A=!0;var W=p;try{for(k(U),f=t(c);f!==null&&(!(f.expirationTime>U)||B&&!O());){var ne=f.callback;if(typeof ne=="function"){f.callback=null,p=f.priorityLevel;var fe=ne(f.expirationTime<=U);U=e.unstable_now(),typeof fe=="function"?f.callback=fe:f===t(c)&&r(c),k(U)}else r(c);f=t(c)}if(f!==null)var Me=!0;else{var Ee=t(d);Ee!==null&&z(b,Ee.startTime-U),Me=!1}return Me}finally{f=null,p=W,A=!1}}var C=!1,S=null,N=-1,M=5,R=-1;function O(){return!(e.unstable_now()-R<M)}function _(){if(S!==null){var B=e.unstable_now();R=B;var U=!0;try{U=S(!0,B)}finally{U?ae():(C=!1,S=null)}}else C=!1}var ae;if(typeof m=="function")ae=function(){m(_)};else if(typeof MessageChannel<"u"){var le=new MessageChannel,fn=le.port2;le.port1.onmessage=_,ae=function(){fn.postMessage(null)}}else ae=function(){w(_,0)};function qe(B){S=B,C||(C=!0,ae())}function z(B,U){N=w(function(){B(e.unstable_now())},U)}e.unstable_IdlePriority=5,e.unstable_ImmediatePriority=1,e.unstable_LowPriority=4,e.unstable_NormalPriority=3,e.unstable_Profiling=null,e.unstable_UserBlockingPriority=2,e.unstable_cancelCallback=function(B){B.callback=null},e.unstable_continueExecution=function(){v||A||(v=!0,qe(y))},e.unstable_forceFrameRate=function(B){0>B||125<B?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):M=0<B?Math.floor(1e3/B):5},e.unstable_getCurrentPriorityLevel=function(){return p},e.unstable_getFirstCallbackNode=function(){return t(c)},e.unstable_next=function(B){switch(p){case 1:case 2:case 3:var U=3;break;default:U=p}var W=p;p=U;try{return B()}finally{p=W}},e.unstable_pauseExecution=function(){},e.unstable_requestPaint=function(){},e.unstable_runWithPriority=function(B,U){switch(B){case 1:case 2:case 3:case 4:case 5:break;default:B=3}var W=p;p=B;try{return U()}finally{p=W}},e.unstable_scheduleCallback=function(B,U,W){var ne=e.unstable_now();switch(typeof W=="object"&&W!==null?(W=W.delay,W=typeof W=="number"&&0<W?ne+W:ne):W=ne,B){case 1:var fe=-1;break;case 2:fe=250;break;case 5:fe=1073741823;break;case 4:fe=1e4;break;default:fe=5e3}return fe=W+fe,B={id:u++,callback:U,priorityLevel:B,startTime:W,expirationTime:fe,sortIndex:-1},W>ne?(B.sortIndex=W,n(d,B),t(c)===null&&B===t(d)&&(x?(g(N),N=-1):x=!0,z(b,W-ne))):(B.sortIndex=fe,n(c,B),v||A||(v=!0,qe(y))),B},e.unstable_shouldYield=O,e.unstable_wrapCallback=function(B){var U=p;return function(){var W=p;p=U;try{return B.apply(this,arguments)}finally{p=W}}}})(_u);Ku.exports=_u;var pm=Ku.exports;/**
 * @license React
 * react-dom.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var hm=h,Je=pm;function L(e){for(var n="https://reactjs.org/docs/error-decoder.html?invariant="+e,t=1;t<arguments.length;t++)n+="&args[]="+encodeURIComponent(arguments[t]);return"Minified React error #"+e+"; visit "+n+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var Gu=new Set,Jr={};function zt(e,n){fr(e,n),fr(e+"Capture",n)}function fr(e,n){for(Jr[e]=n,e=0;e<n.length;e++)Gu.add(n[e])}var Wn=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Xo=Object.prototype.hasOwnProperty,mm=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,Ec={},jc={};function Am(e){return Xo.call(jc,e)?!0:Xo.call(Ec,e)?!1:mm.test(e)?jc[e]=!0:(Ec[e]=!0,!1)}function gm(e,n,t,r){if(t!==null&&t.type===0)return!1;switch(typeof n){case"function":case"symbol":return!0;case"boolean":return r?!1:t!==null?!t.acceptsBooleans:(e=e.toLowerCase().slice(0,5),e!=="data-"&&e!=="aria-");default:return!1}}function vm(e,n,t,r){if(n===null||typeof n>"u"||gm(e,n,t,r))return!0;if(r)return!1;if(t!==null)switch(t.type){case 3:return!n;case 4:return n===!1;case 5:return isNaN(n);case 6:return isNaN(n)||1>n}return!1}function He(e,n,t,r,s,i,o){this.acceptsBooleans=n===2||n===3||n===4,this.attributeName=r,this.attributeNamespace=s,this.mustUseProperty=t,this.propertyName=e,this.type=n,this.sanitizeURL=i,this.removeEmptyString=o}var Se={};"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(e){Se[e]=new He(e,0,!1,e,null,!1,!1)});[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(function(e){var n=e[0];Se[n]=new He(n,1,!1,e[1],null,!1,!1)});["contentEditable","draggable","spellCheck","value"].forEach(function(e){Se[e]=new He(e,2,!1,e.toLowerCase(),null,!1,!1)});["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(function(e){Se[e]=new He(e,2,!1,e,null,!1,!1)});"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(e){Se[e]=new He(e,3,!1,e.toLowerCase(),null,!1,!1)});["checked","multiple","muted","selected"].forEach(function(e){Se[e]=new He(e,3,!0,e,null,!1,!1)});["capture","download"].forEach(function(e){Se[e]=new He(e,4,!1,e,null,!1,!1)});["cols","rows","size","span"].forEach(function(e){Se[e]=new He(e,6,!1,e,null,!1,!1)});["rowSpan","start"].forEach(function(e){Se[e]=new He(e,5,!1,e.toLowerCase(),null,!1,!1)});var ul=/[\-:]([a-z])/g;function fl(e){return e[1].toUpperCase()}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(e){var n=e.replace(ul,fl);Se[n]=new He(n,1,!1,e,null,!1,!1)});"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(e){var n=e.replace(ul,fl);Se[n]=new He(n,1,!1,e,"http://www.w3.org/1999/xlink",!1,!1)});["xml:base","xml:lang","xml:space"].forEach(function(e){var n=e.replace(ul,fl);Se[n]=new He(n,1,!1,e,"http://www.w3.org/XML/1998/namespace",!1,!1)});["tabIndex","crossOrigin"].forEach(function(e){Se[e]=new He(e,1,!1,e.toLowerCase(),null,!1,!1)});Se.xlinkHref=new He("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1);["src","href","action","formAction"].forEach(function(e){Se[e]=new He(e,1,!1,e.toLowerCase(),null,!0,!0)});function pl(e,n,t,r){var s=Se.hasOwnProperty(n)?Se[n]:null;(s!==null?s.type!==0:r||!(2<n.length)||n[0]!=="o"&&n[0]!=="O"||n[1]!=="n"&&n[1]!=="N")&&(vm(n,t,s,r)&&(t=null),r||s===null?Am(n)&&(t===null?e.removeAttribute(n):e.setAttribute(n,""+t)):s.mustUseProperty?e[s.propertyName]=t===null?s.type===3?!1:"":t:(n=s.attributeName,r=s.attributeNamespace,t===null?e.removeAttribute(n):(s=s.type,t=s===3||s===4&&t===!0?"":""+t,r?e.setAttributeNS(r,n,t):e.setAttribute(n,t))))}var qn=hm.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,js=Symbol.for("react.element"),qt=Symbol.for("react.portal"),Qt=Symbol.for("react.fragment"),hl=Symbol.for("react.strict_mode"),Jo=Symbol.for("react.profiler"),qu=Symbol.for("react.provider"),Qu=Symbol.for("react.context"),ml=Symbol.for("react.forward_ref"),$o=Symbol.for("react.suspense"),ea=Symbol.for("react.suspense_list"),Al=Symbol.for("react.memo"),Jn=Symbol.for("react.lazy"),Zu=Symbol.for("react.offscreen"),Nc=Symbol.iterator;function Nr(e){return e===null||typeof e!="object"?null:(e=Nc&&e[Nc]||e["@@iterator"],typeof e=="function"?e:null)}var ue=Object.assign,lo;function Fr(e){if(lo===void 0)try{throw Error()}catch(t){var n=t.stack.trim().match(/\n( *(at )?)/);lo=n&&n[1]||""}return`
`+lo+e}var co=!1;function uo(e,n){if(!e||co)return"";co=!0;var t=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{if(n)if(n=function(){throw Error()},Object.defineProperty(n.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(n,[])}catch(d){var r=d}Reflect.construct(e,[],n)}else{try{n.call()}catch(d){r=d}e.call(n.prototype)}else{try{throw Error()}catch(d){r=d}e()}}catch(d){if(d&&r&&typeof d.stack=="string"){for(var s=d.stack.split(`
`),i=r.stack.split(`
`),o=s.length-1,l=i.length-1;1<=o&&0<=l&&s[o]!==i[l];)l--;for(;1<=o&&0<=l;o--,l--)if(s[o]!==i[l]){if(o!==1||l!==1)do if(o--,l--,0>l||s[o]!==i[l]){var c=`
`+s[o].replace(" at new "," at ");return e.displayName&&c.includes("<anonymous>")&&(c=c.replace("<anonymous>",e.displayName)),c}while(1<=o&&0<=l);break}}}finally{co=!1,Error.prepareStackTrace=t}return(e=e?e.displayName||e.name:"")?Fr(e):""}function xm(e){switch(e.tag){case 5:return Fr(e.type);case 16:return Fr("Lazy");case 13:return Fr("Suspense");case 19:return Fr("SuspenseList");case 0:case 2:case 15:return e=uo(e.type,!1),e;case 11:return e=uo(e.type.render,!1),e;case 1:return e=uo(e.type,!0),e;default:return""}}function na(e){if(e==null)return null;if(typeof e=="function")return e.displayName||e.name||null;if(typeof e=="string")return e;switch(e){case Qt:return"Fragment";case qt:return"Portal";case Jo:return"Profiler";case hl:return"StrictMode";case $o:return"Suspense";case ea:return"SuspenseList"}if(typeof e=="object")switch(e.$$typeof){case Qu:return(e.displayName||"Context")+".Consumer";case qu:return(e._context.displayName||"Context")+".Provider";case ml:var n=e.render;return e=e.displayName,e||(e=n.displayName||n.name||"",e=e!==""?"ForwardRef("+e+")":"ForwardRef"),e;case Al:return n=e.displayName||null,n!==null?n:na(e.type)||"Memo";case Jn:n=e._payload,e=e._init;try{return na(e(n))}catch{}}return null}function km(e){var n=e.type;switch(e.tag){case 24:return"Cache";case 9:return(n.displayName||"Context")+".Consumer";case 10:return(n._context.displayName||"Context")+".Provider";case 18:return"DehydratedFragment";case 11:return e=n.render,e=e.displayName||e.name||"",n.displayName||(e!==""?"ForwardRef("+e+")":"ForwardRef");case 7:return"Fragment";case 5:return n;case 4:return"Portal";case 3:return"Root";case 6:return"Text";case 16:return na(n);case 8:return n===hl?"StrictMode":"Mode";case 22:return"Offscreen";case 12:return"Profiler";case 21:return"Scope";case 13:return"Suspense";case 19:return"SuspenseList";case 25:return"TracingMarker";case 1:case 0:case 17:case 2:case 14:case 15:if(typeof n=="function")return n.displayName||n.name||null;if(typeof n=="string")return n}return null}function At(e){switch(typeof e){case"boolean":case"number":case"string":case"undefined":return e;case"object":return e;default:return""}}function Yu(e){var n=e.type;return(e=e.nodeName)&&e.toLowerCase()==="input"&&(n==="checkbox"||n==="radio")}function wm(e){var n=Yu(e)?"checked":"value",t=Object.getOwnPropertyDescriptor(e.constructor.prototype,n),r=""+e[n];if(!e.hasOwnProperty(n)&&typeof t<"u"&&typeof t.get=="function"&&typeof t.set=="function"){var s=t.get,i=t.set;return Object.defineProperty(e,n,{configurable:!0,get:function(){return s.call(this)},set:function(o){r=""+o,i.call(this,o)}}),Object.defineProperty(e,n,{enumerable:t.enumerable}),{getValue:function(){return r},setValue:function(o){r=""+o},stopTracking:function(){e._valueTracker=null,delete e[n]}}}}function Ns(e){e._valueTracker||(e._valueTracker=wm(e))}function Xu(e){if(!e)return!1;var n=e._valueTracker;if(!n)return!0;var t=n.getValue(),r="";return e&&(r=Yu(e)?e.checked?"true":"false":e.value),e=r,e!==t?(n.setValue(e),!0):!1}function ci(e){if(e=e||(typeof document<"u"?document:void 0),typeof e>"u")return null;try{return e.activeElement||e.body}catch{return e.body}}function ta(e,n){var t=n.checked;return ue({},n,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:t??e._wrapperState.initialChecked})}function Lc(e,n){var t=n.defaultValue==null?"":n.defaultValue,r=n.checked!=null?n.checked:n.defaultChecked;t=At(n.value!=null?n.value:t),e._wrapperState={initialChecked:r,initialValue:t,controlled:n.type==="checkbox"||n.type==="radio"?n.checked!=null:n.value!=null}}function Ju(e,n){n=n.checked,n!=null&&pl(e,"checked",n,!1)}function ra(e,n){Ju(e,n);var t=At(n.value),r=n.type;if(t!=null)r==="number"?(t===0&&e.value===""||e.value!=t)&&(e.value=""+t):e.value!==""+t&&(e.value=""+t);else if(r==="submit"||r==="reset"){e.removeAttribute("value");return}n.hasOwnProperty("value")?sa(e,n.type,t):n.hasOwnProperty("defaultValue")&&sa(e,n.type,At(n.defaultValue)),n.checked==null&&n.defaultChecked!=null&&(e.defaultChecked=!!n.defaultChecked)}function Tc(e,n,t){if(n.hasOwnProperty("value")||n.hasOwnProperty("defaultValue")){var r=n.type;if(!(r!=="submit"&&r!=="reset"||n.value!==void 0&&n.value!==null))return;n=""+e._wrapperState.initialValue,t||n===e.value||(e.value=n),e.defaultValue=n}t=e.name,t!==""&&(e.name=""),e.defaultChecked=!!e._wrapperState.initialChecked,t!==""&&(e.name=t)}function sa(e,n,t){(n!=="number"||ci(e.ownerDocument)!==e)&&(t==null?e.defaultValue=""+e._wrapperState.initialValue:e.defaultValue!==""+t&&(e.defaultValue=""+t))}var Ir=Array.isArray;function ir(e,n,t,r){if(e=e.options,n){n={};for(var s=0;s<t.length;s++)n["$"+t[s]]=!0;for(t=0;t<e.length;t++)s=n.hasOwnProperty("$"+e[t].value),e[t].selected!==s&&(e[t].selected=s),s&&r&&(e[t].defaultSelected=!0)}else{for(t=""+At(t),n=null,s=0;s<e.length;s++){if(e[s].value===t){e[s].selected=!0,r&&(e[s].defaultSelected=!0);return}n!==null||e[s].disabled||(n=e[s])}n!==null&&(n.selected=!0)}}function ia(e,n){if(n.dangerouslySetInnerHTML!=null)throw Error(L(91));return ue({},n,{value:void 0,defaultValue:void 0,children:""+e._wrapperState.initialValue})}function Rc(e,n){var t=n.value;if(t==null){if(t=n.children,n=n.defaultValue,t!=null){if(n!=null)throw Error(L(92));if(Ir(t)){if(1<t.length)throw Error(L(93));t=t[0]}n=t}n==null&&(n=""),t=n}e._wrapperState={initialValue:At(t)}}function $u(e,n){var t=At(n.value),r=At(n.defaultValue);t!=null&&(t=""+t,t!==e.value&&(e.value=t),n.defaultValue==null&&e.defaultValue!==t&&(e.defaultValue=t)),r!=null&&(e.defaultValue=""+r)}function Pc(e){var n=e.textContent;n===e._wrapperState.initialValue&&n!==""&&n!==null&&(e.value=n)}function ef(e){switch(e){case"svg":return"http://www.w3.org/2000/svg";case"math":return"http://www.w3.org/1998/Math/MathML";default:return"http://www.w3.org/1999/xhtml"}}function oa(e,n){return e==null||e==="http://www.w3.org/1999/xhtml"?ef(n):e==="http://www.w3.org/2000/svg"&&n==="foreignObject"?"http://www.w3.org/1999/xhtml":e}var Ls,nf=function(e){return typeof MSApp<"u"&&MSApp.execUnsafeLocalFunction?function(n,t,r,s){MSApp.execUnsafeLocalFunction(function(){return e(n,t,r,s)})}:e}(function(e,n){if(e.namespaceURI!=="http://www.w3.org/2000/svg"||"innerHTML"in e)e.innerHTML=n;else{for(Ls=Ls||document.createElement("div"),Ls.innerHTML="<svg>"+n.valueOf().toString()+"</svg>",n=Ls.firstChild;e.firstChild;)e.removeChild(e.firstChild);for(;n.firstChild;)e.appendChild(n.firstChild)}});function $r(e,n){if(n){var t=e.firstChild;if(t&&t===e.lastChild&&t.nodeType===3){t.nodeValue=n;return}}e.textContent=n}var Wr={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},ym=["Webkit","ms","Moz","O"];Object.keys(Wr).forEach(function(e){ym.forEach(function(n){n=n+e.charAt(0).toUpperCase()+e.substring(1),Wr[n]=Wr[e]})});function tf(e,n,t){return n==null||typeof n=="boolean"||n===""?"":t||typeof n!="number"||n===0||Wr.hasOwnProperty(e)&&Wr[e]?(""+n).trim():n+"px"}function rf(e,n){e=e.style;for(var t in n)if(n.hasOwnProperty(t)){var r=t.indexOf("--")===0,s=tf(t,n[t],r);t==="float"&&(t="cssFloat"),r?e.setProperty(t,s):e[t]=s}}var bm=ue({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0});function aa(e,n){if(n){if(bm[e]&&(n.children!=null||n.dangerouslySetInnerHTML!=null))throw Error(L(137,e));if(n.dangerouslySetInnerHTML!=null){if(n.children!=null)throw Error(L(60));if(typeof n.dangerouslySetInnerHTML!="object"||!("__html"in n.dangerouslySetInnerHTML))throw Error(L(61))}if(n.style!=null&&typeof n.style!="object")throw Error(L(62))}}function la(e,n){if(e.indexOf("-")===-1)return typeof n.is=="string";switch(e){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var ca=null;function gl(e){return e=e.target||e.srcElement||window,e.correspondingUseElement&&(e=e.correspondingUseElement),e.nodeType===3?e.parentNode:e}var da=null,or=null,ar=null;function Mc(e){if(e=ws(e)){if(typeof da!="function")throw Error(L(280));var n=e.stateNode;n&&(n=Vi(n),da(e.stateNode,e.type,n))}}function sf(e){or?ar?ar.push(e):ar=[e]:or=e}function of(){if(or){var e=or,n=ar;if(ar=or=null,Mc(e),n)for(e=0;e<n.length;e++)Mc(n[e])}}function af(e,n){return e(n)}function lf(){}var fo=!1;function cf(e,n,t){if(fo)return e(n,t);fo=!0;try{return af(e,n,t)}finally{fo=!1,(or!==null||ar!==null)&&(lf(),of())}}function es(e,n){var t=e.stateNode;if(t===null)return null;var r=Vi(t);if(r===null)return null;t=r[n];e:switch(n){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(r=!r.disabled)||(e=e.type,r=!(e==="button"||e==="input"||e==="select"||e==="textarea")),e=!r;break e;default:e=!1}if(e)return null;if(t&&typeof t!="function")throw Error(L(231,n,typeof t));return t}var ua=!1;if(Wn)try{var Lr={};Object.defineProperty(Lr,"passive",{get:function(){ua=!0}}),window.addEventListener("test",Lr,Lr),window.removeEventListener("test",Lr,Lr)}catch{ua=!1}function Cm(e,n,t,r,s,i,o,l,c){var d=Array.prototype.slice.call(arguments,3);try{n.apply(t,d)}catch(u){this.onError(u)}}var Vr=!1,di=null,ui=!1,fa=null,Sm={onError:function(e){Vr=!0,di=e}};function Em(e,n,t,r,s,i,o,l,c){Vr=!1,di=null,Cm.apply(Sm,arguments)}function jm(e,n,t,r,s,i,o,l,c){if(Em.apply(this,arguments),Vr){if(Vr){var d=di;Vr=!1,di=null}else throw Error(L(198));ui||(ui=!0,fa=d)}}function Ut(e){var n=e,t=e;if(e.alternate)for(;n.return;)n=n.return;else{e=n;do n=e,n.flags&4098&&(t=n.return),e=n.return;while(e)}return n.tag===3?t:null}function df(e){if(e.tag===13){var n=e.memoizedState;if(n===null&&(e=e.alternate,e!==null&&(n=e.memoizedState)),n!==null)return n.dehydrated}return null}function Bc(e){if(Ut(e)!==e)throw Error(L(188))}function Nm(e){var n=e.alternate;if(!n){if(n=Ut(e),n===null)throw Error(L(188));return n!==e?null:e}for(var t=e,r=n;;){var s=t.return;if(s===null)break;var i=s.alternate;if(i===null){if(r=s.return,r!==null){t=r;continue}break}if(s.child===i.child){for(i=s.child;i;){if(i===t)return Bc(s),e;if(i===r)return Bc(s),n;i=i.sibling}throw Error(L(188))}if(t.return!==r.return)t=s,r=i;else{for(var o=!1,l=s.child;l;){if(l===t){o=!0,t=s,r=i;break}if(l===r){o=!0,r=s,t=i;break}l=l.sibling}if(!o){for(l=i.child;l;){if(l===t){o=!0,t=i,r=s;break}if(l===r){o=!0,r=i,t=s;break}l=l.sibling}if(!o)throw Error(L(189))}}if(t.alternate!==r)throw Error(L(190))}if(t.tag!==3)throw Error(L(188));return t.stateNode.current===t?e:n}function uf(e){return e=Nm(e),e!==null?ff(e):null}function ff(e){if(e.tag===5||e.tag===6)return e;for(e=e.child;e!==null;){var n=ff(e);if(n!==null)return n;e=e.sibling}return null}var pf=Je.unstable_scheduleCallback,Dc=Je.unstable_cancelCallback,Lm=Je.unstable_shouldYield,Tm=Je.unstable_requestPaint,he=Je.unstable_now,Rm=Je.unstable_getCurrentPriorityLevel,vl=Je.unstable_ImmediatePriority,hf=Je.unstable_UserBlockingPriority,fi=Je.unstable_NormalPriority,Pm=Je.unstable_LowPriority,mf=Je.unstable_IdlePriority,Hi=null,Pn=null;function Mm(e){if(Pn&&typeof Pn.onCommitFiberRoot=="function")try{Pn.onCommitFiberRoot(Hi,e,void 0,(e.current.flags&128)===128)}catch{}}var wn=Math.clz32?Math.clz32:Fm,Bm=Math.log,Dm=Math.LN2;function Fm(e){return e>>>=0,e===0?32:31-(Bm(e)/Dm|0)|0}var Ts=64,Rs=4194304;function Or(e){switch(e&-e){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return e&4194240;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return e&130023424;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 1073741824;default:return e}}function pi(e,n){var t=e.pendingLanes;if(t===0)return 0;var r=0,s=e.suspendedLanes,i=e.pingedLanes,o=t&268435455;if(o!==0){var l=o&~s;l!==0?r=Or(l):(i&=o,i!==0&&(r=Or(i)))}else o=t&~s,o!==0?r=Or(o):i!==0&&(r=Or(i));if(r===0)return 0;if(n!==0&&n!==r&&!(n&s)&&(s=r&-r,i=n&-n,s>=i||s===16&&(i&4194240)!==0))return n;if(r&4&&(r|=t&16),n=e.entangledLanes,n!==0)for(e=e.entanglements,n&=r;0<n;)t=31-wn(n),s=1<<t,r|=e[t],n&=~s;return r}function Im(e,n){switch(e){case 1:case 2:case 4:return n+250;case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return n+5e3;case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return-1;case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function Om(e,n){for(var t=e.suspendedLanes,r=e.pingedLanes,s=e.expirationTimes,i=e.pendingLanes;0<i;){var o=31-wn(i),l=1<<o,c=s[o];c===-1?(!(l&t)||l&r)&&(s[o]=Im(l,n)):c<=n&&(e.expiredLanes|=l),i&=~l}}function pa(e){return e=e.pendingLanes&-1073741825,e!==0?e:e&1073741824?1073741824:0}function Af(){var e=Ts;return Ts<<=1,!(Ts&4194240)&&(Ts=64),e}function po(e){for(var n=[],t=0;31>t;t++)n.push(e);return n}function xs(e,n,t){e.pendingLanes|=n,n!==536870912&&(e.suspendedLanes=0,e.pingedLanes=0),e=e.eventTimes,n=31-wn(n),e[n]=t}function Hm(e,n){var t=e.pendingLanes&~n;e.pendingLanes=n,e.suspendedLanes=0,e.pingedLanes=0,e.expiredLanes&=n,e.mutableReadLanes&=n,e.entangledLanes&=n,n=e.entanglements;var r=e.eventTimes;for(e=e.expirationTimes;0<t;){var s=31-wn(t),i=1<<s;n[s]=0,r[s]=-1,e[s]=-1,t&=~i}}function xl(e,n){var t=e.entangledLanes|=n;for(e=e.entanglements;t;){var r=31-wn(t),s=1<<r;s&n|e[r]&n&&(e[r]|=n),t&=~s}}var X=0;function gf(e){return e&=-e,1<e?4<e?e&268435455?16:536870912:4:1}var vf,kl,xf,kf,wf,ha=!1,Ps=[],ot=null,at=null,lt=null,ns=new Map,ts=new Map,nt=[],zm="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");function Fc(e,n){switch(e){case"focusin":case"focusout":ot=null;break;case"dragenter":case"dragleave":at=null;break;case"mouseover":case"mouseout":lt=null;break;case"pointerover":case"pointerout":ns.delete(n.pointerId);break;case"gotpointercapture":case"lostpointercapture":ts.delete(n.pointerId)}}function Tr(e,n,t,r,s,i){return e===null||e.nativeEvent!==i?(e={blockedOn:n,domEventName:t,eventSystemFlags:r,nativeEvent:i,targetContainers:[s]},n!==null&&(n=ws(n),n!==null&&kl(n)),e):(e.eventSystemFlags|=r,n=e.targetContainers,s!==null&&n.indexOf(s)===-1&&n.push(s),e)}function Um(e,n,t,r,s){switch(n){case"focusin":return ot=Tr(ot,e,n,t,r,s),!0;case"dragenter":return at=Tr(at,e,n,t,r,s),!0;case"mouseover":return lt=Tr(lt,e,n,t,r,s),!0;case"pointerover":var i=s.pointerId;return ns.set(i,Tr(ns.get(i)||null,e,n,t,r,s)),!0;case"gotpointercapture":return i=s.pointerId,ts.set(i,Tr(ts.get(i)||null,e,n,t,r,s)),!0}return!1}function yf(e){var n=jt(e.target);if(n!==null){var t=Ut(n);if(t!==null){if(n=t.tag,n===13){if(n=df(t),n!==null){e.blockedOn=n,wf(e.priority,function(){xf(t)});return}}else if(n===3&&t.stateNode.current.memoizedState.isDehydrated){e.blockedOn=t.tag===3?t.stateNode.containerInfo:null;return}}}e.blockedOn=null}function Xs(e){if(e.blockedOn!==null)return!1;for(var n=e.targetContainers;0<n.length;){var t=ma(e.domEventName,e.eventSystemFlags,n[0],e.nativeEvent);if(t===null){t=e.nativeEvent;var r=new t.constructor(t.type,t);ca=r,t.target.dispatchEvent(r),ca=null}else return n=ws(t),n!==null&&kl(n),e.blockedOn=t,!1;n.shift()}return!0}function Ic(e,n,t){Xs(e)&&t.delete(n)}function Wm(){ha=!1,ot!==null&&Xs(ot)&&(ot=null),at!==null&&Xs(at)&&(at=null),lt!==null&&Xs(lt)&&(lt=null),ns.forEach(Ic),ts.forEach(Ic)}function Rr(e,n){e.blockedOn===n&&(e.blockedOn=null,ha||(ha=!0,Je.unstable_scheduleCallback(Je.unstable_NormalPriority,Wm)))}function rs(e){function n(s){return Rr(s,e)}if(0<Ps.length){Rr(Ps[0],e);for(var t=1;t<Ps.length;t++){var r=Ps[t];r.blockedOn===e&&(r.blockedOn=null)}}for(ot!==null&&Rr(ot,e),at!==null&&Rr(at,e),lt!==null&&Rr(lt,e),ns.forEach(n),ts.forEach(n),t=0;t<nt.length;t++)r=nt[t],r.blockedOn===e&&(r.blockedOn=null);for(;0<nt.length&&(t=nt[0],t.blockedOn===null);)yf(t),t.blockedOn===null&&nt.shift()}var lr=qn.ReactCurrentBatchConfig,hi=!0;function Vm(e,n,t,r){var s=X,i=lr.transition;lr.transition=null;try{X=1,wl(e,n,t,r)}finally{X=s,lr.transition=i}}function Km(e,n,t,r){var s=X,i=lr.transition;lr.transition=null;try{X=4,wl(e,n,t,r)}finally{X=s,lr.transition=i}}function wl(e,n,t,r){if(hi){var s=ma(e,n,t,r);if(s===null)bo(e,n,r,mi,t),Fc(e,r);else if(Um(s,e,n,t,r))r.stopPropagation();else if(Fc(e,r),n&4&&-1<zm.indexOf(e)){for(;s!==null;){var i=ws(s);if(i!==null&&vf(i),i=ma(e,n,t,r),i===null&&bo(e,n,r,mi,t),i===s)break;s=i}s!==null&&r.stopPropagation()}else bo(e,n,r,null,t)}}var mi=null;function ma(e,n,t,r){if(mi=null,e=gl(r),e=jt(e),e!==null)if(n=Ut(e),n===null)e=null;else if(t=n.tag,t===13){if(e=df(n),e!==null)return e;e=null}else if(t===3){if(n.stateNode.current.memoizedState.isDehydrated)return n.tag===3?n.stateNode.containerInfo:null;e=null}else n!==e&&(e=null);return mi=e,null}function bf(e){switch(e){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4;case"message":switch(Rm()){case vl:return 1;case hf:return 4;case fi:case Pm:return 16;case mf:return 536870912;default:return 16}default:return 16}}var rt=null,yl=null,Js=null;function Cf(){if(Js)return Js;var e,n=yl,t=n.length,r,s="value"in rt?rt.value:rt.textContent,i=s.length;for(e=0;e<t&&n[e]===s[e];e++);var o=t-e;for(r=1;r<=o&&n[t-r]===s[i-r];r++);return Js=s.slice(e,1<r?1-r:void 0)}function $s(e){var n=e.keyCode;return"charCode"in e?(e=e.charCode,e===0&&n===13&&(e=13)):e=n,e===10&&(e=13),32<=e||e===13?e:0}function Ms(){return!0}function Oc(){return!1}function en(e){function n(t,r,s,i,o){this._reactName=t,this._targetInst=s,this.type=r,this.nativeEvent=i,this.target=o,this.currentTarget=null;for(var l in e)e.hasOwnProperty(l)&&(t=e[l],this[l]=t?t(i):i[l]);return this.isDefaultPrevented=(i.defaultPrevented!=null?i.defaultPrevented:i.returnValue===!1)?Ms:Oc,this.isPropagationStopped=Oc,this}return ue(n.prototype,{preventDefault:function(){this.defaultPrevented=!0;var t=this.nativeEvent;t&&(t.preventDefault?t.preventDefault():typeof t.returnValue!="unknown"&&(t.returnValue=!1),this.isDefaultPrevented=Ms)},stopPropagation:function(){var t=this.nativeEvent;t&&(t.stopPropagation?t.stopPropagation():typeof t.cancelBubble!="unknown"&&(t.cancelBubble=!0),this.isPropagationStopped=Ms)},persist:function(){},isPersistent:Ms}),n}var wr={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(e){return e.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},bl=en(wr),ks=ue({},wr,{view:0,detail:0}),_m=en(ks),ho,mo,Pr,zi=ue({},ks,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Cl,button:0,buttons:0,relatedTarget:function(e){return e.relatedTarget===void 0?e.fromElement===e.srcElement?e.toElement:e.fromElement:e.relatedTarget},movementX:function(e){return"movementX"in e?e.movementX:(e!==Pr&&(Pr&&e.type==="mousemove"?(ho=e.screenX-Pr.screenX,mo=e.screenY-Pr.screenY):mo=ho=0,Pr=e),ho)},movementY:function(e){return"movementY"in e?e.movementY:mo}}),Hc=en(zi),Gm=ue({},zi,{dataTransfer:0}),qm=en(Gm),Qm=ue({},ks,{relatedTarget:0}),Ao=en(Qm),Zm=ue({},wr,{animationName:0,elapsedTime:0,pseudoElement:0}),Ym=en(Zm),Xm=ue({},wr,{clipboardData:function(e){return"clipboardData"in e?e.clipboardData:window.clipboardData}}),Jm=en(Xm),$m=ue({},wr,{data:0}),zc=en($m),eA={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},nA={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},tA={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function rA(e){var n=this.nativeEvent;return n.getModifierState?n.getModifierState(e):(e=tA[e])?!!n[e]:!1}function Cl(){return rA}var sA=ue({},ks,{key:function(e){if(e.key){var n=eA[e.key]||e.key;if(n!=="Unidentified")return n}return e.type==="keypress"?(e=$s(e),e===13?"Enter":String.fromCharCode(e)):e.type==="keydown"||e.type==="keyup"?nA[e.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Cl,charCode:function(e){return e.type==="keypress"?$s(e):0},keyCode:function(e){return e.type==="keydown"||e.type==="keyup"?e.keyCode:0},which:function(e){return e.type==="keypress"?$s(e):e.type==="keydown"||e.type==="keyup"?e.keyCode:0}}),iA=en(sA),oA=ue({},zi,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),Uc=en(oA),aA=ue({},ks,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Cl}),lA=en(aA),cA=ue({},wr,{propertyName:0,elapsedTime:0,pseudoElement:0}),dA=en(cA),uA=ue({},zi,{deltaX:function(e){return"deltaX"in e?e.deltaX:"wheelDeltaX"in e?-e.wheelDeltaX:0},deltaY:function(e){return"deltaY"in e?e.deltaY:"wheelDeltaY"in e?-e.wheelDeltaY:"wheelDelta"in e?-e.wheelDelta:0},deltaZ:0,deltaMode:0}),fA=en(uA),pA=[9,13,27,32],Sl=Wn&&"CompositionEvent"in window,Kr=null;Wn&&"documentMode"in document&&(Kr=document.documentMode);var hA=Wn&&"TextEvent"in window&&!Kr,Sf=Wn&&(!Sl||Kr&&8<Kr&&11>=Kr),Wc=" ",Vc=!1;function Ef(e,n){switch(e){case"keyup":return pA.indexOf(n.keyCode)!==-1;case"keydown":return n.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function jf(e){return e=e.detail,typeof e=="object"&&"data"in e?e.data:null}var Zt=!1;function mA(e,n){switch(e){case"compositionend":return jf(n);case"keypress":return n.which!==32?null:(Vc=!0,Wc);case"textInput":return e=n.data,e===Wc&&Vc?null:e;default:return null}}function AA(e,n){if(Zt)return e==="compositionend"||!Sl&&Ef(e,n)?(e=Cf(),Js=yl=rt=null,Zt=!1,e):null;switch(e){case"paste":return null;case"keypress":if(!(n.ctrlKey||n.altKey||n.metaKey)||n.ctrlKey&&n.altKey){if(n.char&&1<n.char.length)return n.char;if(n.which)return String.fromCharCode(n.which)}return null;case"compositionend":return Sf&&n.locale!=="ko"?null:n.data;default:return null}}var gA={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function Kc(e){var n=e&&e.nodeName&&e.nodeName.toLowerCase();return n==="input"?!!gA[e.type]:n==="textarea"}function Nf(e,n,t,r){sf(r),n=Ai(n,"onChange"),0<n.length&&(t=new bl("onChange","change",null,t,r),e.push({event:t,listeners:n}))}var _r=null,ss=null;function vA(e){Hf(e,0)}function Ui(e){var n=Jt(e);if(Xu(n))return e}function xA(e,n){if(e==="change")return n}var Lf=!1;if(Wn){var go;if(Wn){var vo="oninput"in document;if(!vo){var _c=document.createElement("div");_c.setAttribute("oninput","return;"),vo=typeof _c.oninput=="function"}go=vo}else go=!1;Lf=go&&(!document.documentMode||9<document.documentMode)}function Gc(){_r&&(_r.detachEvent("onpropertychange",Tf),ss=_r=null)}function Tf(e){if(e.propertyName==="value"&&Ui(ss)){var n=[];Nf(n,ss,e,gl(e)),cf(vA,n)}}function kA(e,n,t){e==="focusin"?(Gc(),_r=n,ss=t,_r.attachEvent("onpropertychange",Tf)):e==="focusout"&&Gc()}function wA(e){if(e==="selectionchange"||e==="keyup"||e==="keydown")return Ui(ss)}function yA(e,n){if(e==="click")return Ui(n)}function bA(e,n){if(e==="input"||e==="change")return Ui(n)}function CA(e,n){return e===n&&(e!==0||1/e===1/n)||e!==e&&n!==n}var bn=typeof Object.is=="function"?Object.is:CA;function is(e,n){if(bn(e,n))return!0;if(typeof e!="object"||e===null||typeof n!="object"||n===null)return!1;var t=Object.keys(e),r=Object.keys(n);if(t.length!==r.length)return!1;for(r=0;r<t.length;r++){var s=t[r];if(!Xo.call(n,s)||!bn(e[s],n[s]))return!1}return!0}function qc(e){for(;e&&e.firstChild;)e=e.firstChild;return e}function Qc(e,n){var t=qc(e);e=0;for(var r;t;){if(t.nodeType===3){if(r=e+t.textContent.length,e<=n&&r>=n)return{node:t,offset:n-e};e=r}e:{for(;t;){if(t.nextSibling){t=t.nextSibling;break e}t=t.parentNode}t=void 0}t=qc(t)}}function Rf(e,n){return e&&n?e===n?!0:e&&e.nodeType===3?!1:n&&n.nodeType===3?Rf(e,n.parentNode):"contains"in e?e.contains(n):e.compareDocumentPosition?!!(e.compareDocumentPosition(n)&16):!1:!1}function Pf(){for(var e=window,n=ci();n instanceof e.HTMLIFrameElement;){try{var t=typeof n.contentWindow.location.href=="string"}catch{t=!1}if(t)e=n.contentWindow;else break;n=ci(e.document)}return n}function El(e){var n=e&&e.nodeName&&e.nodeName.toLowerCase();return n&&(n==="input"&&(e.type==="text"||e.type==="search"||e.type==="tel"||e.type==="url"||e.type==="password")||n==="textarea"||e.contentEditable==="true")}function SA(e){var n=Pf(),t=e.focusedElem,r=e.selectionRange;if(n!==t&&t&&t.ownerDocument&&Rf(t.ownerDocument.documentElement,t)){if(r!==null&&El(t)){if(n=r.start,e=r.end,e===void 0&&(e=n),"selectionStart"in t)t.selectionStart=n,t.selectionEnd=Math.min(e,t.value.length);else if(e=(n=t.ownerDocument||document)&&n.defaultView||window,e.getSelection){e=e.getSelection();var s=t.textContent.length,i=Math.min(r.start,s);r=r.end===void 0?i:Math.min(r.end,s),!e.extend&&i>r&&(s=r,r=i,i=s),s=Qc(t,i);var o=Qc(t,r);s&&o&&(e.rangeCount!==1||e.anchorNode!==s.node||e.anchorOffset!==s.offset||e.focusNode!==o.node||e.focusOffset!==o.offset)&&(n=n.createRange(),n.setStart(s.node,s.offset),e.removeAllRanges(),i>r?(e.addRange(n),e.extend(o.node,o.offset)):(n.setEnd(o.node,o.offset),e.addRange(n)))}}for(n=[],e=t;e=e.parentNode;)e.nodeType===1&&n.push({element:e,left:e.scrollLeft,top:e.scrollTop});for(typeof t.focus=="function"&&t.focus(),t=0;t<n.length;t++)e=n[t],e.element.scrollLeft=e.left,e.element.scrollTop=e.top}}var EA=Wn&&"documentMode"in document&&11>=document.documentMode,Yt=null,Aa=null,Gr=null,ga=!1;function Zc(e,n,t){var r=t.window===t?t.document:t.nodeType===9?t:t.ownerDocument;ga||Yt==null||Yt!==ci(r)||(r=Yt,"selectionStart"in r&&El(r)?r={start:r.selectionStart,end:r.selectionEnd}:(r=(r.ownerDocument&&r.ownerDocument.defaultView||window).getSelection(),r={anchorNode:r.anchorNode,anchorOffset:r.anchorOffset,focusNode:r.focusNode,focusOffset:r.focusOffset}),Gr&&is(Gr,r)||(Gr=r,r=Ai(Aa,"onSelect"),0<r.length&&(n=new bl("onSelect","select",null,n,t),e.push({event:n,listeners:r}),n.target=Yt)))}function Bs(e,n){var t={};return t[e.toLowerCase()]=n.toLowerCase(),t["Webkit"+e]="webkit"+n,t["Moz"+e]="moz"+n,t}var Xt={animationend:Bs("Animation","AnimationEnd"),animationiteration:Bs("Animation","AnimationIteration"),animationstart:Bs("Animation","AnimationStart"),transitionend:Bs("Transition","TransitionEnd")},xo={},Mf={};Wn&&(Mf=document.createElement("div").style,"AnimationEvent"in window||(delete Xt.animationend.animation,delete Xt.animationiteration.animation,delete Xt.animationstart.animation),"TransitionEvent"in window||delete Xt.transitionend.transition);function Wi(e){if(xo[e])return xo[e];if(!Xt[e])return e;var n=Xt[e],t;for(t in n)if(n.hasOwnProperty(t)&&t in Mf)return xo[e]=n[t];return e}var Bf=Wi("animationend"),Df=Wi("animationiteration"),Ff=Wi("animationstart"),If=Wi("transitionend"),Of=new Map,Yc="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");function vt(e,n){Of.set(e,n),zt(n,[e])}for(var ko=0;ko<Yc.length;ko++){var wo=Yc[ko],jA=wo.toLowerCase(),NA=wo[0].toUpperCase()+wo.slice(1);vt(jA,"on"+NA)}vt(Bf,"onAnimationEnd");vt(Df,"onAnimationIteration");vt(Ff,"onAnimationStart");vt("dblclick","onDoubleClick");vt("focusin","onFocus");vt("focusout","onBlur");vt(If,"onTransitionEnd");fr("onMouseEnter",["mouseout","mouseover"]);fr("onMouseLeave",["mouseout","mouseover"]);fr("onPointerEnter",["pointerout","pointerover"]);fr("onPointerLeave",["pointerout","pointerover"]);zt("onChange","change click focusin focusout input keydown keyup selectionchange".split(" "));zt("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));zt("onBeforeInput",["compositionend","keypress","textInput","paste"]);zt("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" "));zt("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" "));zt("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var Hr="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),LA=new Set("cancel close invalid load scroll toggle".split(" ").concat(Hr));function Xc(e,n,t){var r=e.type||"unknown-event";e.currentTarget=t,jm(r,n,void 0,e),e.currentTarget=null}function Hf(e,n){n=(n&4)!==0;for(var t=0;t<e.length;t++){var r=e[t],s=r.event;r=r.listeners;e:{var i=void 0;if(n)for(var o=r.length-1;0<=o;o--){var l=r[o],c=l.instance,d=l.currentTarget;if(l=l.listener,c!==i&&s.isPropagationStopped())break e;Xc(s,l,d),i=c}else for(o=0;o<r.length;o++){if(l=r[o],c=l.instance,d=l.currentTarget,l=l.listener,c!==i&&s.isPropagationStopped())break e;Xc(s,l,d),i=c}}}if(ui)throw e=fa,ui=!1,fa=null,e}function te(e,n){var t=n[ya];t===void 0&&(t=n[ya]=new Set);var r=e+"__bubble";t.has(r)||(zf(n,e,2,!1),t.add(r))}function yo(e,n,t){var r=0;n&&(r|=4),zf(t,e,r,n)}var Ds="_reactListening"+Math.random().toString(36).slice(2);function os(e){if(!e[Ds]){e[Ds]=!0,Gu.forEach(function(t){t!=="selectionchange"&&(LA.has(t)||yo(t,!1,e),yo(t,!0,e))});var n=e.nodeType===9?e:e.ownerDocument;n===null||n[Ds]||(n[Ds]=!0,yo("selectionchange",!1,n))}}function zf(e,n,t,r){switch(bf(n)){case 1:var s=Vm;break;case 4:s=Km;break;default:s=wl}t=s.bind(null,n,t,e),s=void 0,!ua||n!=="touchstart"&&n!=="touchmove"&&n!=="wheel"||(s=!0),r?s!==void 0?e.addEventListener(n,t,{capture:!0,passive:s}):e.addEventListener(n,t,!0):s!==void 0?e.addEventListener(n,t,{passive:s}):e.addEventListener(n,t,!1)}function bo(e,n,t,r,s){var i=r;if(!(n&1)&&!(n&2)&&r!==null)e:for(;;){if(r===null)return;var o=r.tag;if(o===3||o===4){var l=r.stateNode.containerInfo;if(l===s||l.nodeType===8&&l.parentNode===s)break;if(o===4)for(o=r.return;o!==null;){var c=o.tag;if((c===3||c===4)&&(c=o.stateNode.containerInfo,c===s||c.nodeType===8&&c.parentNode===s))return;o=o.return}for(;l!==null;){if(o=jt(l),o===null)return;if(c=o.tag,c===5||c===6){r=i=o;continue e}l=l.parentNode}}r=r.return}cf(function(){var d=i,u=gl(t),f=[];e:{var p=Of.get(e);if(p!==void 0){var A=bl,v=e;switch(e){case"keypress":if($s(t)===0)break e;case"keydown":case"keyup":A=iA;break;case"focusin":v="focus",A=Ao;break;case"focusout":v="blur",A=Ao;break;case"beforeblur":case"afterblur":A=Ao;break;case"click":if(t.button===2)break e;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":A=Hc;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":A=qm;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":A=lA;break;case Bf:case Df:case Ff:A=Ym;break;case If:A=dA;break;case"scroll":A=_m;break;case"wheel":A=fA;break;case"copy":case"cut":case"paste":A=Jm;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":A=Uc}var x=(n&4)!==0,w=!x&&e==="scroll",g=x?p!==null?p+"Capture":null:p;x=[];for(var m=d,k;m!==null;){k=m;var b=k.stateNode;if(k.tag===5&&b!==null&&(k=b,g!==null&&(b=es(m,g),b!=null&&x.push(as(m,b,k)))),w)break;m=m.return}0<x.length&&(p=new A(p,v,null,t,u),f.push({event:p,listeners:x}))}}if(!(n&7)){e:{if(p=e==="mouseover"||e==="pointerover",A=e==="mouseout"||e==="pointerout",p&&t!==ca&&(v=t.relatedTarget||t.fromElement)&&(jt(v)||v[Vn]))break e;if((A||p)&&(p=u.window===u?u:(p=u.ownerDocument)?p.defaultView||p.parentWindow:window,A?(v=t.relatedTarget||t.toElement,A=d,v=v?jt(v):null,v!==null&&(w=Ut(v),v!==w||v.tag!==5&&v.tag!==6)&&(v=null)):(A=null,v=d),A!==v)){if(x=Hc,b="onMouseLeave",g="onMouseEnter",m="mouse",(e==="pointerout"||e==="pointerover")&&(x=Uc,b="onPointerLeave",g="onPointerEnter",m="pointer"),w=A==null?p:Jt(A),k=v==null?p:Jt(v),p=new x(b,m+"leave",A,t,u),p.target=w,p.relatedTarget=k,b=null,jt(u)===d&&(x=new x(g,m+"enter",v,t,u),x.target=k,x.relatedTarget=w,b=x),w=b,A&&v)n:{for(x=A,g=v,m=0,k=x;k;k=_t(k))m++;for(k=0,b=g;b;b=_t(b))k++;for(;0<m-k;)x=_t(x),m--;for(;0<k-m;)g=_t(g),k--;for(;m--;){if(x===g||g!==null&&x===g.alternate)break n;x=_t(x),g=_t(g)}x=null}else x=null;A!==null&&Jc(f,p,A,x,!1),v!==null&&w!==null&&Jc(f,w,v,x,!0)}}e:{if(p=d?Jt(d):window,A=p.nodeName&&p.nodeName.toLowerCase(),A==="select"||A==="input"&&p.type==="file")var y=xA;else if(Kc(p))if(Lf)y=bA;else{y=wA;var C=kA}else(A=p.nodeName)&&A.toLowerCase()==="input"&&(p.type==="checkbox"||p.type==="radio")&&(y=yA);if(y&&(y=y(e,d))){Nf(f,y,t,u);break e}C&&C(e,p,d),e==="focusout"&&(C=p._wrapperState)&&C.controlled&&p.type==="number"&&sa(p,"number",p.value)}switch(C=d?Jt(d):window,e){case"focusin":(Kc(C)||C.contentEditable==="true")&&(Yt=C,Aa=d,Gr=null);break;case"focusout":Gr=Aa=Yt=null;break;case"mousedown":ga=!0;break;case"contextmenu":case"mouseup":case"dragend":ga=!1,Zc(f,t,u);break;case"selectionchange":if(EA)break;case"keydown":case"keyup":Zc(f,t,u)}var S;if(Sl)e:{switch(e){case"compositionstart":var N="onCompositionStart";break e;case"compositionend":N="onCompositionEnd";break e;case"compositionupdate":N="onCompositionUpdate";break e}N=void 0}else Zt?Ef(e,t)&&(N="onCompositionEnd"):e==="keydown"&&t.keyCode===229&&(N="onCompositionStart");N&&(Sf&&t.locale!=="ko"&&(Zt||N!=="onCompositionStart"?N==="onCompositionEnd"&&Zt&&(S=Cf()):(rt=u,yl="value"in rt?rt.value:rt.textContent,Zt=!0)),C=Ai(d,N),0<C.length&&(N=new zc(N,e,null,t,u),f.push({event:N,listeners:C}),S?N.data=S:(S=jf(t),S!==null&&(N.data=S)))),(S=hA?mA(e,t):AA(e,t))&&(d=Ai(d,"onBeforeInput"),0<d.length&&(u=new zc("onBeforeInput","beforeinput",null,t,u),f.push({event:u,listeners:d}),u.data=S))}Hf(f,n)})}function as(e,n,t){return{instance:e,listener:n,currentTarget:t}}function Ai(e,n){for(var t=n+"Capture",r=[];e!==null;){var s=e,i=s.stateNode;s.tag===5&&i!==null&&(s=i,i=es(e,t),i!=null&&r.unshift(as(e,i,s)),i=es(e,n),i!=null&&r.push(as(e,i,s))),e=e.return}return r}function _t(e){if(e===null)return null;do e=e.return;while(e&&e.tag!==5);return e||null}function Jc(e,n,t,r,s){for(var i=n._reactName,o=[];t!==null&&t!==r;){var l=t,c=l.alternate,d=l.stateNode;if(c!==null&&c===r)break;l.tag===5&&d!==null&&(l=d,s?(c=es(t,i),c!=null&&o.unshift(as(t,c,l))):s||(c=es(t,i),c!=null&&o.push(as(t,c,l)))),t=t.return}o.length!==0&&e.push({event:n,listeners:o})}var TA=/\r\n?/g,RA=/\u0000|\uFFFD/g;function $c(e){return(typeof e=="string"?e:""+e).replace(TA,`
`).replace(RA,"")}function Fs(e,n,t){if(n=$c(n),$c(e)!==n&&t)throw Error(L(425))}function gi(){}var va=null,xa=null;function ka(e,n){return e==="textarea"||e==="noscript"||typeof n.children=="string"||typeof n.children=="number"||typeof n.dangerouslySetInnerHTML=="object"&&n.dangerouslySetInnerHTML!==null&&n.dangerouslySetInnerHTML.__html!=null}var wa=typeof setTimeout=="function"?setTimeout:void 0,PA=typeof clearTimeout=="function"?clearTimeout:void 0,ed=typeof Promise=="function"?Promise:void 0,MA=typeof queueMicrotask=="function"?queueMicrotask:typeof ed<"u"?function(e){return ed.resolve(null).then(e).catch(BA)}:wa;function BA(e){setTimeout(function(){throw e})}function Co(e,n){var t=n,r=0;do{var s=t.nextSibling;if(e.removeChild(t),s&&s.nodeType===8)if(t=s.data,t==="/$"){if(r===0){e.removeChild(s),rs(n);return}r--}else t!=="$"&&t!=="$?"&&t!=="$!"||r++;t=s}while(t);rs(n)}function ct(e){for(;e!=null;e=e.nextSibling){var n=e.nodeType;if(n===1||n===3)break;if(n===8){if(n=e.data,n==="$"||n==="$!"||n==="$?")break;if(n==="/$")return null}}return e}function nd(e){e=e.previousSibling;for(var n=0;e;){if(e.nodeType===8){var t=e.data;if(t==="$"||t==="$!"||t==="$?"){if(n===0)return e;n--}else t==="/$"&&n++}e=e.previousSibling}return null}var yr=Math.random().toString(36).slice(2),Rn="__reactFiber$"+yr,ls="__reactProps$"+yr,Vn="__reactContainer$"+yr,ya="__reactEvents$"+yr,DA="__reactListeners$"+yr,FA="__reactHandles$"+yr;function jt(e){var n=e[Rn];if(n)return n;for(var t=e.parentNode;t;){if(n=t[Vn]||t[Rn]){if(t=n.alternate,n.child!==null||t!==null&&t.child!==null)for(e=nd(e);e!==null;){if(t=e[Rn])return t;e=nd(e)}return n}e=t,t=e.parentNode}return null}function ws(e){return e=e[Rn]||e[Vn],!e||e.tag!==5&&e.tag!==6&&e.tag!==13&&e.tag!==3?null:e}function Jt(e){if(e.tag===5||e.tag===6)return e.stateNode;throw Error(L(33))}function Vi(e){return e[ls]||null}var ba=[],$t=-1;function xt(e){return{current:e}}function re(e){0>$t||(e.current=ba[$t],ba[$t]=null,$t--)}function ee(e,n){$t++,ba[$t]=e.current,e.current=n}var gt={},Pe=xt(gt),Ke=xt(!1),Mt=gt;function pr(e,n){var t=e.type.contextTypes;if(!t)return gt;var r=e.stateNode;if(r&&r.__reactInternalMemoizedUnmaskedChildContext===n)return r.__reactInternalMemoizedMaskedChildContext;var s={},i;for(i in t)s[i]=n[i];return r&&(e=e.stateNode,e.__reactInternalMemoizedUnmaskedChildContext=n,e.__reactInternalMemoizedMaskedChildContext=s),s}function _e(e){return e=e.childContextTypes,e!=null}function vi(){re(Ke),re(Pe)}function td(e,n,t){if(Pe.current!==gt)throw Error(L(168));ee(Pe,n),ee(Ke,t)}function Uf(e,n,t){var r=e.stateNode;if(n=n.childContextTypes,typeof r.getChildContext!="function")return t;r=r.getChildContext();for(var s in r)if(!(s in n))throw Error(L(108,km(e)||"Unknown",s));return ue({},t,r)}function xi(e){return e=(e=e.stateNode)&&e.__reactInternalMemoizedMergedChildContext||gt,Mt=Pe.current,ee(Pe,e),ee(Ke,Ke.current),!0}function rd(e,n,t){var r=e.stateNode;if(!r)throw Error(L(169));t?(e=Uf(e,n,Mt),r.__reactInternalMemoizedMergedChildContext=e,re(Ke),re(Pe),ee(Pe,e)):re(Ke),ee(Ke,t)}var Fn=null,Ki=!1,So=!1;function Wf(e){Fn===null?Fn=[e]:Fn.push(e)}function IA(e){Ki=!0,Wf(e)}function kt(){if(!So&&Fn!==null){So=!0;var e=0,n=X;try{var t=Fn;for(X=1;e<t.length;e++){var r=t[e];do r=r(!0);while(r!==null)}Fn=null,Ki=!1}catch(s){throw Fn!==null&&(Fn=Fn.slice(e+1)),pf(vl,kt),s}finally{X=n,So=!1}}return null}var er=[],nr=0,ki=null,wi=0,sn=[],on=0,Bt=null,In=1,On="";function Ct(e,n){er[nr++]=wi,er[nr++]=ki,ki=e,wi=n}function Vf(e,n,t){sn[on++]=In,sn[on++]=On,sn[on++]=Bt,Bt=e;var r=In;e=On;var s=32-wn(r)-1;r&=~(1<<s),t+=1;var i=32-wn(n)+s;if(30<i){var o=s-s%5;i=(r&(1<<o)-1).toString(32),r>>=o,s-=o,In=1<<32-wn(n)+s|t<<s|r,On=i+e}else In=1<<i|t<<s|r,On=e}function jl(e){e.return!==null&&(Ct(e,1),Vf(e,1,0))}function Nl(e){for(;e===ki;)ki=er[--nr],er[nr]=null,wi=er[--nr],er[nr]=null;for(;e===Bt;)Bt=sn[--on],sn[on]=null,On=sn[--on],sn[on]=null,In=sn[--on],sn[on]=null}var Xe=null,Ye=null,oe=!1,vn=null;function Kf(e,n){var t=an(5,null,null,0);t.elementType="DELETED",t.stateNode=n,t.return=e,n=e.deletions,n===null?(e.deletions=[t],e.flags|=16):n.push(t)}function sd(e,n){switch(e.tag){case 5:var t=e.type;return n=n.nodeType!==1||t.toLowerCase()!==n.nodeName.toLowerCase()?null:n,n!==null?(e.stateNode=n,Xe=e,Ye=ct(n.firstChild),!0):!1;case 6:return n=e.pendingProps===""||n.nodeType!==3?null:n,n!==null?(e.stateNode=n,Xe=e,Ye=null,!0):!1;case 13:return n=n.nodeType!==8?null:n,n!==null?(t=Bt!==null?{id:In,overflow:On}:null,e.memoizedState={dehydrated:n,treeContext:t,retryLane:1073741824},t=an(18,null,null,0),t.stateNode=n,t.return=e,e.child=t,Xe=e,Ye=null,!0):!1;default:return!1}}function Ca(e){return(e.mode&1)!==0&&(e.flags&128)===0}function Sa(e){if(oe){var n=Ye;if(n){var t=n;if(!sd(e,n)){if(Ca(e))throw Error(L(418));n=ct(t.nextSibling);var r=Xe;n&&sd(e,n)?Kf(r,t):(e.flags=e.flags&-4097|2,oe=!1,Xe=e)}}else{if(Ca(e))throw Error(L(418));e.flags=e.flags&-4097|2,oe=!1,Xe=e}}}function id(e){for(e=e.return;e!==null&&e.tag!==5&&e.tag!==3&&e.tag!==13;)e=e.return;Xe=e}function Is(e){if(e!==Xe)return!1;if(!oe)return id(e),oe=!0,!1;var n;if((n=e.tag!==3)&&!(n=e.tag!==5)&&(n=e.type,n=n!=="head"&&n!=="body"&&!ka(e.type,e.memoizedProps)),n&&(n=Ye)){if(Ca(e))throw _f(),Error(L(418));for(;n;)Kf(e,n),n=ct(n.nextSibling)}if(id(e),e.tag===13){if(e=e.memoizedState,e=e!==null?e.dehydrated:null,!e)throw Error(L(317));e:{for(e=e.nextSibling,n=0;e;){if(e.nodeType===8){var t=e.data;if(t==="/$"){if(n===0){Ye=ct(e.nextSibling);break e}n--}else t!=="$"&&t!=="$!"&&t!=="$?"||n++}e=e.nextSibling}Ye=null}}else Ye=Xe?ct(e.stateNode.nextSibling):null;return!0}function _f(){for(var e=Ye;e;)e=ct(e.nextSibling)}function hr(){Ye=Xe=null,oe=!1}function Ll(e){vn===null?vn=[e]:vn.push(e)}var OA=qn.ReactCurrentBatchConfig;function Mr(e,n,t){if(e=t.ref,e!==null&&typeof e!="function"&&typeof e!="object"){if(t._owner){if(t=t._owner,t){if(t.tag!==1)throw Error(L(309));var r=t.stateNode}if(!r)throw Error(L(147,e));var s=r,i=""+e;return n!==null&&n.ref!==null&&typeof n.ref=="function"&&n.ref._stringRef===i?n.ref:(n=function(o){var l=s.refs;o===null?delete l[i]:l[i]=o},n._stringRef=i,n)}if(typeof e!="string")throw Error(L(284));if(!t._owner)throw Error(L(290,e))}return e}function Os(e,n){throw e=Object.prototype.toString.call(n),Error(L(31,e==="[object Object]"?"object with keys {"+Object.keys(n).join(", ")+"}":e))}function od(e){var n=e._init;return n(e._payload)}function Gf(e){function n(g,m){if(e){var k=g.deletions;k===null?(g.deletions=[m],g.flags|=16):k.push(m)}}function t(g,m){if(!e)return null;for(;m!==null;)n(g,m),m=m.sibling;return null}function r(g,m){for(g=new Map;m!==null;)m.key!==null?g.set(m.key,m):g.set(m.index,m),m=m.sibling;return g}function s(g,m){return g=pt(g,m),g.index=0,g.sibling=null,g}function i(g,m,k){return g.index=k,e?(k=g.alternate,k!==null?(k=k.index,k<m?(g.flags|=2,m):k):(g.flags|=2,m)):(g.flags|=1048576,m)}function o(g){return e&&g.alternate===null&&(g.flags|=2),g}function l(g,m,k,b){return m===null||m.tag!==6?(m=Po(k,g.mode,b),m.return=g,m):(m=s(m,k),m.return=g,m)}function c(g,m,k,b){var y=k.type;return y===Qt?u(g,m,k.props.children,b,k.key):m!==null&&(m.elementType===y||typeof y=="object"&&y!==null&&y.$$typeof===Jn&&od(y)===m.type)?(b=s(m,k.props),b.ref=Mr(g,m,k),b.return=g,b):(b=oi(k.type,k.key,k.props,null,g.mode,b),b.ref=Mr(g,m,k),b.return=g,b)}function d(g,m,k,b){return m===null||m.tag!==4||m.stateNode.containerInfo!==k.containerInfo||m.stateNode.implementation!==k.implementation?(m=Mo(k,g.mode,b),m.return=g,m):(m=s(m,k.children||[]),m.return=g,m)}function u(g,m,k,b,y){return m===null||m.tag!==7?(m=Pt(k,g.mode,b,y),m.return=g,m):(m=s(m,k),m.return=g,m)}function f(g,m,k){if(typeof m=="string"&&m!==""||typeof m=="number")return m=Po(""+m,g.mode,k),m.return=g,m;if(typeof m=="object"&&m!==null){switch(m.$$typeof){case js:return k=oi(m.type,m.key,m.props,null,g.mode,k),k.ref=Mr(g,null,m),k.return=g,k;case qt:return m=Mo(m,g.mode,k),m.return=g,m;case Jn:var b=m._init;return f(g,b(m._payload),k)}if(Ir(m)||Nr(m))return m=Pt(m,g.mode,k,null),m.return=g,m;Os(g,m)}return null}function p(g,m,k,b){var y=m!==null?m.key:null;if(typeof k=="string"&&k!==""||typeof k=="number")return y!==null?null:l(g,m,""+k,b);if(typeof k=="object"&&k!==null){switch(k.$$typeof){case js:return k.key===y?c(g,m,k,b):null;case qt:return k.key===y?d(g,m,k,b):null;case Jn:return y=k._init,p(g,m,y(k._payload),b)}if(Ir(k)||Nr(k))return y!==null?null:u(g,m,k,b,null);Os(g,k)}return null}function A(g,m,k,b,y){if(typeof b=="string"&&b!==""||typeof b=="number")return g=g.get(k)||null,l(m,g,""+b,y);if(typeof b=="object"&&b!==null){switch(b.$$typeof){case js:return g=g.get(b.key===null?k:b.key)||null,c(m,g,b,y);case qt:return g=g.get(b.key===null?k:b.key)||null,d(m,g,b,y);case Jn:var C=b._init;return A(g,m,k,C(b._payload),y)}if(Ir(b)||Nr(b))return g=g.get(k)||null,u(m,g,b,y,null);Os(m,b)}return null}function v(g,m,k,b){for(var y=null,C=null,S=m,N=m=0,M=null;S!==null&&N<k.length;N++){S.index>N?(M=S,S=null):M=S.sibling;var R=p(g,S,k[N],b);if(R===null){S===null&&(S=M);break}e&&S&&R.alternate===null&&n(g,S),m=i(R,m,N),C===null?y=R:C.sibling=R,C=R,S=M}if(N===k.length)return t(g,S),oe&&Ct(g,N),y;if(S===null){for(;N<k.length;N++)S=f(g,k[N],b),S!==null&&(m=i(S,m,N),C===null?y=S:C.sibling=S,C=S);return oe&&Ct(g,N),y}for(S=r(g,S);N<k.length;N++)M=A(S,g,N,k[N],b),M!==null&&(e&&M.alternate!==null&&S.delete(M.key===null?N:M.key),m=i(M,m,N),C===null?y=M:C.sibling=M,C=M);return e&&S.forEach(function(O){return n(g,O)}),oe&&Ct(g,N),y}function x(g,m,k,b){var y=Nr(k);if(typeof y!="function")throw Error(L(150));if(k=y.call(k),k==null)throw Error(L(151));for(var C=y=null,S=m,N=m=0,M=null,R=k.next();S!==null&&!R.done;N++,R=k.next()){S.index>N?(M=S,S=null):M=S.sibling;var O=p(g,S,R.value,b);if(O===null){S===null&&(S=M);break}e&&S&&O.alternate===null&&n(g,S),m=i(O,m,N),C===null?y=O:C.sibling=O,C=O,S=M}if(R.done)return t(g,S),oe&&Ct(g,N),y;if(S===null){for(;!R.done;N++,R=k.next())R=f(g,R.value,b),R!==null&&(m=i(R,m,N),C===null?y=R:C.sibling=R,C=R);return oe&&Ct(g,N),y}for(S=r(g,S);!R.done;N++,R=k.next())R=A(S,g,N,R.value,b),R!==null&&(e&&R.alternate!==null&&S.delete(R.key===null?N:R.key),m=i(R,m,N),C===null?y=R:C.sibling=R,C=R);return e&&S.forEach(function(_){return n(g,_)}),oe&&Ct(g,N),y}function w(g,m,k,b){if(typeof k=="object"&&k!==null&&k.type===Qt&&k.key===null&&(k=k.props.children),typeof k=="object"&&k!==null){switch(k.$$typeof){case js:e:{for(var y=k.key,C=m;C!==null;){if(C.key===y){if(y=k.type,y===Qt){if(C.tag===7){t(g,C.sibling),m=s(C,k.props.children),m.return=g,g=m;break e}}else if(C.elementType===y||typeof y=="object"&&y!==null&&y.$$typeof===Jn&&od(y)===C.type){t(g,C.sibling),m=s(C,k.props),m.ref=Mr(g,C,k),m.return=g,g=m;break e}t(g,C);break}else n(g,C);C=C.sibling}k.type===Qt?(m=Pt(k.props.children,g.mode,b,k.key),m.return=g,g=m):(b=oi(k.type,k.key,k.props,null,g.mode,b),b.ref=Mr(g,m,k),b.return=g,g=b)}return o(g);case qt:e:{for(C=k.key;m!==null;){if(m.key===C)if(m.tag===4&&m.stateNode.containerInfo===k.containerInfo&&m.stateNode.implementation===k.implementation){t(g,m.sibling),m=s(m,k.children||[]),m.return=g,g=m;break e}else{t(g,m);break}else n(g,m);m=m.sibling}m=Mo(k,g.mode,b),m.return=g,g=m}return o(g);case Jn:return C=k._init,w(g,m,C(k._payload),b)}if(Ir(k))return v(g,m,k,b);if(Nr(k))return x(g,m,k,b);Os(g,k)}return typeof k=="string"&&k!==""||typeof k=="number"?(k=""+k,m!==null&&m.tag===6?(t(g,m.sibling),m=s(m,k),m.return=g,g=m):(t(g,m),m=Po(k,g.mode,b),m.return=g,g=m),o(g)):t(g,m)}return w}var mr=Gf(!0),qf=Gf(!1),yi=xt(null),bi=null,tr=null,Tl=null;function Rl(){Tl=tr=bi=null}function Pl(e){var n=yi.current;re(yi),e._currentValue=n}function Ea(e,n,t){for(;e!==null;){var r=e.alternate;if((e.childLanes&n)!==n?(e.childLanes|=n,r!==null&&(r.childLanes|=n)):r!==null&&(r.childLanes&n)!==n&&(r.childLanes|=n),e===t)break;e=e.return}}function cr(e,n){bi=e,Tl=tr=null,e=e.dependencies,e!==null&&e.firstContext!==null&&(e.lanes&n&&(Ve=!0),e.firstContext=null)}function dn(e){var n=e._currentValue;if(Tl!==e)if(e={context:e,memoizedValue:n,next:null},tr===null){if(bi===null)throw Error(L(308));tr=e,bi.dependencies={lanes:0,firstContext:e}}else tr=tr.next=e;return n}var Nt=null;function Ml(e){Nt===null?Nt=[e]:Nt.push(e)}function Qf(e,n,t,r){var s=n.interleaved;return s===null?(t.next=t,Ml(n)):(t.next=s.next,s.next=t),n.interleaved=t,Kn(e,r)}function Kn(e,n){e.lanes|=n;var t=e.alternate;for(t!==null&&(t.lanes|=n),t=e,e=e.return;e!==null;)e.childLanes|=n,t=e.alternate,t!==null&&(t.childLanes|=n),t=e,e=e.return;return t.tag===3?t.stateNode:null}var $n=!1;function Bl(e){e.updateQueue={baseState:e.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Zf(e,n){e=e.updateQueue,n.updateQueue===e&&(n.updateQueue={baseState:e.baseState,firstBaseUpdate:e.firstBaseUpdate,lastBaseUpdate:e.lastBaseUpdate,shared:e.shared,effects:e.effects})}function zn(e,n){return{eventTime:e,lane:n,tag:0,payload:null,callback:null,next:null}}function dt(e,n,t){var r=e.updateQueue;if(r===null)return null;if(r=r.shared,Q&2){var s=r.pending;return s===null?n.next=n:(n.next=s.next,s.next=n),r.pending=n,Kn(e,t)}return s=r.interleaved,s===null?(n.next=n,Ml(r)):(n.next=s.next,s.next=n),r.interleaved=n,Kn(e,t)}function ei(e,n,t){if(n=n.updateQueue,n!==null&&(n=n.shared,(t&4194240)!==0)){var r=n.lanes;r&=e.pendingLanes,t|=r,n.lanes=t,xl(e,t)}}function ad(e,n){var t=e.updateQueue,r=e.alternate;if(r!==null&&(r=r.updateQueue,t===r)){var s=null,i=null;if(t=t.firstBaseUpdate,t!==null){do{var o={eventTime:t.eventTime,lane:t.lane,tag:t.tag,payload:t.payload,callback:t.callback,next:null};i===null?s=i=o:i=i.next=o,t=t.next}while(t!==null);i===null?s=i=n:i=i.next=n}else s=i=n;t={baseState:r.baseState,firstBaseUpdate:s,lastBaseUpdate:i,shared:r.shared,effects:r.effects},e.updateQueue=t;return}e=t.lastBaseUpdate,e===null?t.firstBaseUpdate=n:e.next=n,t.lastBaseUpdate=n}function Ci(e,n,t,r){var s=e.updateQueue;$n=!1;var i=s.firstBaseUpdate,o=s.lastBaseUpdate,l=s.shared.pending;if(l!==null){s.shared.pending=null;var c=l,d=c.next;c.next=null,o===null?i=d:o.next=d,o=c;var u=e.alternate;u!==null&&(u=u.updateQueue,l=u.lastBaseUpdate,l!==o&&(l===null?u.firstBaseUpdate=d:l.next=d,u.lastBaseUpdate=c))}if(i!==null){var f=s.baseState;o=0,u=d=c=null,l=i;do{var p=l.lane,A=l.eventTime;if((r&p)===p){u!==null&&(u=u.next={eventTime:A,lane:0,tag:l.tag,payload:l.payload,callback:l.callback,next:null});e:{var v=e,x=l;switch(p=n,A=t,x.tag){case 1:if(v=x.payload,typeof v=="function"){f=v.call(A,f,p);break e}f=v;break e;case 3:v.flags=v.flags&-65537|128;case 0:if(v=x.payload,p=typeof v=="function"?v.call(A,f,p):v,p==null)break e;f=ue({},f,p);break e;case 2:$n=!0}}l.callback!==null&&l.lane!==0&&(e.flags|=64,p=s.effects,p===null?s.effects=[l]:p.push(l))}else A={eventTime:A,lane:p,tag:l.tag,payload:l.payload,callback:l.callback,next:null},u===null?(d=u=A,c=f):u=u.next=A,o|=p;if(l=l.next,l===null){if(l=s.shared.pending,l===null)break;p=l,l=p.next,p.next=null,s.lastBaseUpdate=p,s.shared.pending=null}}while(!0);if(u===null&&(c=f),s.baseState=c,s.firstBaseUpdate=d,s.lastBaseUpdate=u,n=s.shared.interleaved,n!==null){s=n;do o|=s.lane,s=s.next;while(s!==n)}else i===null&&(s.shared.lanes=0);Ft|=o,e.lanes=o,e.memoizedState=f}}function ld(e,n,t){if(e=n.effects,n.effects=null,e!==null)for(n=0;n<e.length;n++){var r=e[n],s=r.callback;if(s!==null){if(r.callback=null,r=t,typeof s!="function")throw Error(L(191,s));s.call(r)}}}var ys={},Mn=xt(ys),cs=xt(ys),ds=xt(ys);function Lt(e){if(e===ys)throw Error(L(174));return e}function Dl(e,n){switch(ee(ds,n),ee(cs,e),ee(Mn,ys),e=n.nodeType,e){case 9:case 11:n=(n=n.documentElement)?n.namespaceURI:oa(null,"");break;default:e=e===8?n.parentNode:n,n=e.namespaceURI||null,e=e.tagName,n=oa(n,e)}re(Mn),ee(Mn,n)}function Ar(){re(Mn),re(cs),re(ds)}function Yf(e){Lt(ds.current);var n=Lt(Mn.current),t=oa(n,e.type);n!==t&&(ee(cs,e),ee(Mn,t))}function Fl(e){cs.current===e&&(re(Mn),re(cs))}var ce=xt(0);function Si(e){for(var n=e;n!==null;){if(n.tag===13){var t=n.memoizedState;if(t!==null&&(t=t.dehydrated,t===null||t.data==="$?"||t.data==="$!"))return n}else if(n.tag===19&&n.memoizedProps.revealOrder!==void 0){if(n.flags&128)return n}else if(n.child!==null){n.child.return=n,n=n.child;continue}if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return null;n=n.return}n.sibling.return=n.return,n=n.sibling}return null}var Eo=[];function Il(){for(var e=0;e<Eo.length;e++)Eo[e]._workInProgressVersionPrimary=null;Eo.length=0}var ni=qn.ReactCurrentDispatcher,jo=qn.ReactCurrentBatchConfig,Dt=0,de=null,ve=null,we=null,Ei=!1,qr=!1,us=0,HA=0;function je(){throw Error(L(321))}function Ol(e,n){if(n===null)return!1;for(var t=0;t<n.length&&t<e.length;t++)if(!bn(e[t],n[t]))return!1;return!0}function Hl(e,n,t,r,s,i){if(Dt=i,de=n,n.memoizedState=null,n.updateQueue=null,n.lanes=0,ni.current=e===null||e.memoizedState===null?VA:KA,e=t(r,s),qr){i=0;do{if(qr=!1,us=0,25<=i)throw Error(L(301));i+=1,we=ve=null,n.updateQueue=null,ni.current=_A,e=t(r,s)}while(qr)}if(ni.current=ji,n=ve!==null&&ve.next!==null,Dt=0,we=ve=de=null,Ei=!1,n)throw Error(L(300));return e}function zl(){var e=us!==0;return us=0,e}function Tn(){var e={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return we===null?de.memoizedState=we=e:we=we.next=e,we}function un(){if(ve===null){var e=de.alternate;e=e!==null?e.memoizedState:null}else e=ve.next;var n=we===null?de.memoizedState:we.next;if(n!==null)we=n,ve=e;else{if(e===null)throw Error(L(310));ve=e,e={memoizedState:ve.memoizedState,baseState:ve.baseState,baseQueue:ve.baseQueue,queue:ve.queue,next:null},we===null?de.memoizedState=we=e:we=we.next=e}return we}function fs(e,n){return typeof n=="function"?n(e):n}function No(e){var n=un(),t=n.queue;if(t===null)throw Error(L(311));t.lastRenderedReducer=e;var r=ve,s=r.baseQueue,i=t.pending;if(i!==null){if(s!==null){var o=s.next;s.next=i.next,i.next=o}r.baseQueue=s=i,t.pending=null}if(s!==null){i=s.next,r=r.baseState;var l=o=null,c=null,d=i;do{var u=d.lane;if((Dt&u)===u)c!==null&&(c=c.next={lane:0,action:d.action,hasEagerState:d.hasEagerState,eagerState:d.eagerState,next:null}),r=d.hasEagerState?d.eagerState:e(r,d.action);else{var f={lane:u,action:d.action,hasEagerState:d.hasEagerState,eagerState:d.eagerState,next:null};c===null?(l=c=f,o=r):c=c.next=f,de.lanes|=u,Ft|=u}d=d.next}while(d!==null&&d!==i);c===null?o=r:c.next=l,bn(r,n.memoizedState)||(Ve=!0),n.memoizedState=r,n.baseState=o,n.baseQueue=c,t.lastRenderedState=r}if(e=t.interleaved,e!==null){s=e;do i=s.lane,de.lanes|=i,Ft|=i,s=s.next;while(s!==e)}else s===null&&(t.lanes=0);return[n.memoizedState,t.dispatch]}function Lo(e){var n=un(),t=n.queue;if(t===null)throw Error(L(311));t.lastRenderedReducer=e;var r=t.dispatch,s=t.pending,i=n.memoizedState;if(s!==null){t.pending=null;var o=s=s.next;do i=e(i,o.action),o=o.next;while(o!==s);bn(i,n.memoizedState)||(Ve=!0),n.memoizedState=i,n.baseQueue===null&&(n.baseState=i),t.lastRenderedState=i}return[i,r]}function Xf(){}function Jf(e,n){var t=de,r=un(),s=n(),i=!bn(r.memoizedState,s);if(i&&(r.memoizedState=s,Ve=!0),r=r.queue,Ul(np.bind(null,t,r,e),[e]),r.getSnapshot!==n||i||we!==null&&we.memoizedState.tag&1){if(t.flags|=2048,ps(9,ep.bind(null,t,r,s,n),void 0,null),ye===null)throw Error(L(349));Dt&30||$f(t,n,s)}return s}function $f(e,n,t){e.flags|=16384,e={getSnapshot:n,value:t},n=de.updateQueue,n===null?(n={lastEffect:null,stores:null},de.updateQueue=n,n.stores=[e]):(t=n.stores,t===null?n.stores=[e]:t.push(e))}function ep(e,n,t,r){n.value=t,n.getSnapshot=r,tp(n)&&rp(e)}function np(e,n,t){return t(function(){tp(n)&&rp(e)})}function tp(e){var n=e.getSnapshot;e=e.value;try{var t=n();return!bn(e,t)}catch{return!0}}function rp(e){var n=Kn(e,1);n!==null&&yn(n,e,1,-1)}function cd(e){var n=Tn();return typeof e=="function"&&(e=e()),n.memoizedState=n.baseState=e,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:fs,lastRenderedState:e},n.queue=e,e=e.dispatch=WA.bind(null,de,e),[n.memoizedState,e]}function ps(e,n,t,r){return e={tag:e,create:n,destroy:t,deps:r,next:null},n=de.updateQueue,n===null?(n={lastEffect:null,stores:null},de.updateQueue=n,n.lastEffect=e.next=e):(t=n.lastEffect,t===null?n.lastEffect=e.next=e:(r=t.next,t.next=e,e.next=r,n.lastEffect=e)),e}function sp(){return un().memoizedState}function ti(e,n,t,r){var s=Tn();de.flags|=e,s.memoizedState=ps(1|n,t,void 0,r===void 0?null:r)}function _i(e,n,t,r){var s=un();r=r===void 0?null:r;var i=void 0;if(ve!==null){var o=ve.memoizedState;if(i=o.destroy,r!==null&&Ol(r,o.deps)){s.memoizedState=ps(n,t,i,r);return}}de.flags|=e,s.memoizedState=ps(1|n,t,i,r)}function dd(e,n){return ti(8390656,8,e,n)}function Ul(e,n){return _i(2048,8,e,n)}function ip(e,n){return _i(4,2,e,n)}function op(e,n){return _i(4,4,e,n)}function ap(e,n){if(typeof n=="function")return e=e(),n(e),function(){n(null)};if(n!=null)return e=e(),n.current=e,function(){n.current=null}}function lp(e,n,t){return t=t!=null?t.concat([e]):null,_i(4,4,ap.bind(null,n,e),t)}function Wl(){}function cp(e,n){var t=un();n=n===void 0?null:n;var r=t.memoizedState;return r!==null&&n!==null&&Ol(n,r[1])?r[0]:(t.memoizedState=[e,n],e)}function dp(e,n){var t=un();n=n===void 0?null:n;var r=t.memoizedState;return r!==null&&n!==null&&Ol(n,r[1])?r[0]:(e=e(),t.memoizedState=[e,n],e)}function up(e,n,t){return Dt&21?(bn(t,n)||(t=Af(),de.lanes|=t,Ft|=t,e.baseState=!0),n):(e.baseState&&(e.baseState=!1,Ve=!0),e.memoizedState=t)}function zA(e,n){var t=X;X=t!==0&&4>t?t:4,e(!0);var r=jo.transition;jo.transition={};try{e(!1),n()}finally{X=t,jo.transition=r}}function fp(){return un().memoizedState}function UA(e,n,t){var r=ft(e);if(t={lane:r,action:t,hasEagerState:!1,eagerState:null,next:null},pp(e))hp(n,t);else if(t=Qf(e,n,t,r),t!==null){var s=Ie();yn(t,e,r,s),mp(t,n,r)}}function WA(e,n,t){var r=ft(e),s={lane:r,action:t,hasEagerState:!1,eagerState:null,next:null};if(pp(e))hp(n,s);else{var i=e.alternate;if(e.lanes===0&&(i===null||i.lanes===0)&&(i=n.lastRenderedReducer,i!==null))try{var o=n.lastRenderedState,l=i(o,t);if(s.hasEagerState=!0,s.eagerState=l,bn(l,o)){var c=n.interleaved;c===null?(s.next=s,Ml(n)):(s.next=c.next,c.next=s),n.interleaved=s;return}}catch{}finally{}t=Qf(e,n,s,r),t!==null&&(s=Ie(),yn(t,e,r,s),mp(t,n,r))}}function pp(e){var n=e.alternate;return e===de||n!==null&&n===de}function hp(e,n){qr=Ei=!0;var t=e.pending;t===null?n.next=n:(n.next=t.next,t.next=n),e.pending=n}function mp(e,n,t){if(t&4194240){var r=n.lanes;r&=e.pendingLanes,t|=r,n.lanes=t,xl(e,t)}}var ji={readContext:dn,useCallback:je,useContext:je,useEffect:je,useImperativeHandle:je,useInsertionEffect:je,useLayoutEffect:je,useMemo:je,useReducer:je,useRef:je,useState:je,useDebugValue:je,useDeferredValue:je,useTransition:je,useMutableSource:je,useSyncExternalStore:je,useId:je,unstable_isNewReconciler:!1},VA={readContext:dn,useCallback:function(e,n){return Tn().memoizedState=[e,n===void 0?null:n],e},useContext:dn,useEffect:dd,useImperativeHandle:function(e,n,t){return t=t!=null?t.concat([e]):null,ti(4194308,4,ap.bind(null,n,e),t)},useLayoutEffect:function(e,n){return ti(4194308,4,e,n)},useInsertionEffect:function(e,n){return ti(4,2,e,n)},useMemo:function(e,n){var t=Tn();return n=n===void 0?null:n,e=e(),t.memoizedState=[e,n],e},useReducer:function(e,n,t){var r=Tn();return n=t!==void 0?t(n):n,r.memoizedState=r.baseState=n,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:e,lastRenderedState:n},r.queue=e,e=e.dispatch=UA.bind(null,de,e),[r.memoizedState,e]},useRef:function(e){var n=Tn();return e={current:e},n.memoizedState=e},useState:cd,useDebugValue:Wl,useDeferredValue:function(e){return Tn().memoizedState=e},useTransition:function(){var e=cd(!1),n=e[0];return e=zA.bind(null,e[1]),Tn().memoizedState=e,[n,e]},useMutableSource:function(){},useSyncExternalStore:function(e,n,t){var r=de,s=Tn();if(oe){if(t===void 0)throw Error(L(407));t=t()}else{if(t=n(),ye===null)throw Error(L(349));Dt&30||$f(r,n,t)}s.memoizedState=t;var i={value:t,getSnapshot:n};return s.queue=i,dd(np.bind(null,r,i,e),[e]),r.flags|=2048,ps(9,ep.bind(null,r,i,t,n),void 0,null),t},useId:function(){var e=Tn(),n=ye.identifierPrefix;if(oe){var t=On,r=In;t=(r&~(1<<32-wn(r)-1)).toString(32)+t,n=":"+n+"R"+t,t=us++,0<t&&(n+="H"+t.toString(32)),n+=":"}else t=HA++,n=":"+n+"r"+t.toString(32)+":";return e.memoizedState=n},unstable_isNewReconciler:!1},KA={readContext:dn,useCallback:cp,useContext:dn,useEffect:Ul,useImperativeHandle:lp,useInsertionEffect:ip,useLayoutEffect:op,useMemo:dp,useReducer:No,useRef:sp,useState:function(){return No(fs)},useDebugValue:Wl,useDeferredValue:function(e){var n=un();return up(n,ve.memoizedState,e)},useTransition:function(){var e=No(fs)[0],n=un().memoizedState;return[e,n]},useMutableSource:Xf,useSyncExternalStore:Jf,useId:fp,unstable_isNewReconciler:!1},_A={readContext:dn,useCallback:cp,useContext:dn,useEffect:Ul,useImperativeHandle:lp,useInsertionEffect:ip,useLayoutEffect:op,useMemo:dp,useReducer:Lo,useRef:sp,useState:function(){return Lo(fs)},useDebugValue:Wl,useDeferredValue:function(e){var n=un();return ve===null?n.memoizedState=e:up(n,ve.memoizedState,e)},useTransition:function(){var e=Lo(fs)[0],n=un().memoizedState;return[e,n]},useMutableSource:Xf,useSyncExternalStore:Jf,useId:fp,unstable_isNewReconciler:!1};function An(e,n){if(e&&e.defaultProps){n=ue({},n),e=e.defaultProps;for(var t in e)n[t]===void 0&&(n[t]=e[t]);return n}return n}function ja(e,n,t,r){n=e.memoizedState,t=t(r,n),t=t==null?n:ue({},n,t),e.memoizedState=t,e.lanes===0&&(e.updateQueue.baseState=t)}var Gi={isMounted:function(e){return(e=e._reactInternals)?Ut(e)===e:!1},enqueueSetState:function(e,n,t){e=e._reactInternals;var r=Ie(),s=ft(e),i=zn(r,s);i.payload=n,t!=null&&(i.callback=t),n=dt(e,i,s),n!==null&&(yn(n,e,s,r),ei(n,e,s))},enqueueReplaceState:function(e,n,t){e=e._reactInternals;var r=Ie(),s=ft(e),i=zn(r,s);i.tag=1,i.payload=n,t!=null&&(i.callback=t),n=dt(e,i,s),n!==null&&(yn(n,e,s,r),ei(n,e,s))},enqueueForceUpdate:function(e,n){e=e._reactInternals;var t=Ie(),r=ft(e),s=zn(t,r);s.tag=2,n!=null&&(s.callback=n),n=dt(e,s,r),n!==null&&(yn(n,e,r,t),ei(n,e,r))}};function ud(e,n,t,r,s,i,o){return e=e.stateNode,typeof e.shouldComponentUpdate=="function"?e.shouldComponentUpdate(r,i,o):n.prototype&&n.prototype.isPureReactComponent?!is(t,r)||!is(s,i):!0}function Ap(e,n,t){var r=!1,s=gt,i=n.contextType;return typeof i=="object"&&i!==null?i=dn(i):(s=_e(n)?Mt:Pe.current,r=n.contextTypes,i=(r=r!=null)?pr(e,s):gt),n=new n(t,i),e.memoizedState=n.state!==null&&n.state!==void 0?n.state:null,n.updater=Gi,e.stateNode=n,n._reactInternals=e,r&&(e=e.stateNode,e.__reactInternalMemoizedUnmaskedChildContext=s,e.__reactInternalMemoizedMaskedChildContext=i),n}function fd(e,n,t,r){e=n.state,typeof n.componentWillReceiveProps=="function"&&n.componentWillReceiveProps(t,r),typeof n.UNSAFE_componentWillReceiveProps=="function"&&n.UNSAFE_componentWillReceiveProps(t,r),n.state!==e&&Gi.enqueueReplaceState(n,n.state,null)}function Na(e,n,t,r){var s=e.stateNode;s.props=t,s.state=e.memoizedState,s.refs={},Bl(e);var i=n.contextType;typeof i=="object"&&i!==null?s.context=dn(i):(i=_e(n)?Mt:Pe.current,s.context=pr(e,i)),s.state=e.memoizedState,i=n.getDerivedStateFromProps,typeof i=="function"&&(ja(e,n,i,t),s.state=e.memoizedState),typeof n.getDerivedStateFromProps=="function"||typeof s.getSnapshotBeforeUpdate=="function"||typeof s.UNSAFE_componentWillMount!="function"&&typeof s.componentWillMount!="function"||(n=s.state,typeof s.componentWillMount=="function"&&s.componentWillMount(),typeof s.UNSAFE_componentWillMount=="function"&&s.UNSAFE_componentWillMount(),n!==s.state&&Gi.enqueueReplaceState(s,s.state,null),Ci(e,t,s,r),s.state=e.memoizedState),typeof s.componentDidMount=="function"&&(e.flags|=4194308)}function gr(e,n){try{var t="",r=n;do t+=xm(r),r=r.return;while(r);var s=t}catch(i){s=`
Error generating stack: `+i.message+`
`+i.stack}return{value:e,source:n,stack:s,digest:null}}function To(e,n,t){return{value:e,source:null,stack:t??null,digest:n??null}}function La(e,n){try{console.error(n.value)}catch(t){setTimeout(function(){throw t})}}var GA=typeof WeakMap=="function"?WeakMap:Map;function gp(e,n,t){t=zn(-1,t),t.tag=3,t.payload={element:null};var r=n.value;return t.callback=function(){Li||(Li=!0,Ha=r),La(e,n)},t}function vp(e,n,t){t=zn(-1,t),t.tag=3;var r=e.type.getDerivedStateFromError;if(typeof r=="function"){var s=n.value;t.payload=function(){return r(s)},t.callback=function(){La(e,n)}}var i=e.stateNode;return i!==null&&typeof i.componentDidCatch=="function"&&(t.callback=function(){La(e,n),typeof r!="function"&&(ut===null?ut=new Set([this]):ut.add(this));var o=n.stack;this.componentDidCatch(n.value,{componentStack:o!==null?o:""})}),t}function pd(e,n,t){var r=e.pingCache;if(r===null){r=e.pingCache=new GA;var s=new Set;r.set(n,s)}else s=r.get(n),s===void 0&&(s=new Set,r.set(n,s));s.has(t)||(s.add(t),e=o1.bind(null,e,n,t),n.then(e,e))}function hd(e){do{var n;if((n=e.tag===13)&&(n=e.memoizedState,n=n!==null?n.dehydrated!==null:!0),n)return e;e=e.return}while(e!==null);return null}function md(e,n,t,r,s){return e.mode&1?(e.flags|=65536,e.lanes=s,e):(e===n?e.flags|=65536:(e.flags|=128,t.flags|=131072,t.flags&=-52805,t.tag===1&&(t.alternate===null?t.tag=17:(n=zn(-1,1),n.tag=2,dt(t,n,1))),t.lanes|=1),e)}var qA=qn.ReactCurrentOwner,Ve=!1;function De(e,n,t,r){n.child=e===null?qf(n,null,t,r):mr(n,e.child,t,r)}function Ad(e,n,t,r,s){t=t.render;var i=n.ref;return cr(n,s),r=Hl(e,n,t,r,i,s),t=zl(),e!==null&&!Ve?(n.updateQueue=e.updateQueue,n.flags&=-2053,e.lanes&=~s,_n(e,n,s)):(oe&&t&&jl(n),n.flags|=1,De(e,n,r,s),n.child)}function gd(e,n,t,r,s){if(e===null){var i=t.type;return typeof i=="function"&&!Yl(i)&&i.defaultProps===void 0&&t.compare===null&&t.defaultProps===void 0?(n.tag=15,n.type=i,xp(e,n,i,r,s)):(e=oi(t.type,null,r,n,n.mode,s),e.ref=n.ref,e.return=n,n.child=e)}if(i=e.child,!(e.lanes&s)){var o=i.memoizedProps;if(t=t.compare,t=t!==null?t:is,t(o,r)&&e.ref===n.ref)return _n(e,n,s)}return n.flags|=1,e=pt(i,r),e.ref=n.ref,e.return=n,n.child=e}function xp(e,n,t,r,s){if(e!==null){var i=e.memoizedProps;if(is(i,r)&&e.ref===n.ref)if(Ve=!1,n.pendingProps=r=i,(e.lanes&s)!==0)e.flags&131072&&(Ve=!0);else return n.lanes=e.lanes,_n(e,n,s)}return Ta(e,n,t,r,s)}function kp(e,n,t){var r=n.pendingProps,s=r.children,i=e!==null?e.memoizedState:null;if(r.mode==="hidden")if(!(n.mode&1))n.memoizedState={baseLanes:0,cachePool:null,transitions:null},ee(sr,Ze),Ze|=t;else{if(!(t&1073741824))return e=i!==null?i.baseLanes|t:t,n.lanes=n.childLanes=1073741824,n.memoizedState={baseLanes:e,cachePool:null,transitions:null},n.updateQueue=null,ee(sr,Ze),Ze|=e,null;n.memoizedState={baseLanes:0,cachePool:null,transitions:null},r=i!==null?i.baseLanes:t,ee(sr,Ze),Ze|=r}else i!==null?(r=i.baseLanes|t,n.memoizedState=null):r=t,ee(sr,Ze),Ze|=r;return De(e,n,s,t),n.child}function wp(e,n){var t=n.ref;(e===null&&t!==null||e!==null&&e.ref!==t)&&(n.flags|=512,n.flags|=2097152)}function Ta(e,n,t,r,s){var i=_e(t)?Mt:Pe.current;return i=pr(n,i),cr(n,s),t=Hl(e,n,t,r,i,s),r=zl(),e!==null&&!Ve?(n.updateQueue=e.updateQueue,n.flags&=-2053,e.lanes&=~s,_n(e,n,s)):(oe&&r&&jl(n),n.flags|=1,De(e,n,t,s),n.child)}function vd(e,n,t,r,s){if(_e(t)){var i=!0;xi(n)}else i=!1;if(cr(n,s),n.stateNode===null)ri(e,n),Ap(n,t,r),Na(n,t,r,s),r=!0;else if(e===null){var o=n.stateNode,l=n.memoizedProps;o.props=l;var c=o.context,d=t.contextType;typeof d=="object"&&d!==null?d=dn(d):(d=_e(t)?Mt:Pe.current,d=pr(n,d));var u=t.getDerivedStateFromProps,f=typeof u=="function"||typeof o.getSnapshotBeforeUpdate=="function";f||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(l!==r||c!==d)&&fd(n,o,r,d),$n=!1;var p=n.memoizedState;o.state=p,Ci(n,r,o,s),c=n.memoizedState,l!==r||p!==c||Ke.current||$n?(typeof u=="function"&&(ja(n,t,u,r),c=n.memoizedState),(l=$n||ud(n,t,l,r,p,c,d))?(f||typeof o.UNSAFE_componentWillMount!="function"&&typeof o.componentWillMount!="function"||(typeof o.componentWillMount=="function"&&o.componentWillMount(),typeof o.UNSAFE_componentWillMount=="function"&&o.UNSAFE_componentWillMount()),typeof o.componentDidMount=="function"&&(n.flags|=4194308)):(typeof o.componentDidMount=="function"&&(n.flags|=4194308),n.memoizedProps=r,n.memoizedState=c),o.props=r,o.state=c,o.context=d,r=l):(typeof o.componentDidMount=="function"&&(n.flags|=4194308),r=!1)}else{o=n.stateNode,Zf(e,n),l=n.memoizedProps,d=n.type===n.elementType?l:An(n.type,l),o.props=d,f=n.pendingProps,p=o.context,c=t.contextType,typeof c=="object"&&c!==null?c=dn(c):(c=_e(t)?Mt:Pe.current,c=pr(n,c));var A=t.getDerivedStateFromProps;(u=typeof A=="function"||typeof o.getSnapshotBeforeUpdate=="function")||typeof o.UNSAFE_componentWillReceiveProps!="function"&&typeof o.componentWillReceiveProps!="function"||(l!==f||p!==c)&&fd(n,o,r,c),$n=!1,p=n.memoizedState,o.state=p,Ci(n,r,o,s);var v=n.memoizedState;l!==f||p!==v||Ke.current||$n?(typeof A=="function"&&(ja(n,t,A,r),v=n.memoizedState),(d=$n||ud(n,t,d,r,p,v,c)||!1)?(u||typeof o.UNSAFE_componentWillUpdate!="function"&&typeof o.componentWillUpdate!="function"||(typeof o.componentWillUpdate=="function"&&o.componentWillUpdate(r,v,c),typeof o.UNSAFE_componentWillUpdate=="function"&&o.UNSAFE_componentWillUpdate(r,v,c)),typeof o.componentDidUpdate=="function"&&(n.flags|=4),typeof o.getSnapshotBeforeUpdate=="function"&&(n.flags|=1024)):(typeof o.componentDidUpdate!="function"||l===e.memoizedProps&&p===e.memoizedState||(n.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||l===e.memoizedProps&&p===e.memoizedState||(n.flags|=1024),n.memoizedProps=r,n.memoizedState=v),o.props=r,o.state=v,o.context=c,r=d):(typeof o.componentDidUpdate!="function"||l===e.memoizedProps&&p===e.memoizedState||(n.flags|=4),typeof o.getSnapshotBeforeUpdate!="function"||l===e.memoizedProps&&p===e.memoizedState||(n.flags|=1024),r=!1)}return Ra(e,n,t,r,i,s)}function Ra(e,n,t,r,s,i){wp(e,n);var o=(n.flags&128)!==0;if(!r&&!o)return s&&rd(n,t,!1),_n(e,n,i);r=n.stateNode,qA.current=n;var l=o&&typeof t.getDerivedStateFromError!="function"?null:r.render();return n.flags|=1,e!==null&&o?(n.child=mr(n,e.child,null,i),n.child=mr(n,null,l,i)):De(e,n,l,i),n.memoizedState=r.state,s&&rd(n,t,!0),n.child}function yp(e){var n=e.stateNode;n.pendingContext?td(e,n.pendingContext,n.pendingContext!==n.context):n.context&&td(e,n.context,!1),Dl(e,n.containerInfo)}function xd(e,n,t,r,s){return hr(),Ll(s),n.flags|=256,De(e,n,t,r),n.child}var Pa={dehydrated:null,treeContext:null,retryLane:0};function Ma(e){return{baseLanes:e,cachePool:null,transitions:null}}function bp(e,n,t){var r=n.pendingProps,s=ce.current,i=!1,o=(n.flags&128)!==0,l;if((l=o)||(l=e!==null&&e.memoizedState===null?!1:(s&2)!==0),l?(i=!0,n.flags&=-129):(e===null||e.memoizedState!==null)&&(s|=1),ee(ce,s&1),e===null)return Sa(n),e=n.memoizedState,e!==null&&(e=e.dehydrated,e!==null)?(n.mode&1?e.data==="$!"?n.lanes=8:n.lanes=1073741824:n.lanes=1,null):(o=r.children,e=r.fallback,i?(r=n.mode,i=n.child,o={mode:"hidden",children:o},!(r&1)&&i!==null?(i.childLanes=0,i.pendingProps=o):i=Zi(o,r,0,null),e=Pt(e,r,t,null),i.return=n,e.return=n,i.sibling=e,n.child=i,n.child.memoizedState=Ma(t),n.memoizedState=Pa,e):Vl(n,o));if(s=e.memoizedState,s!==null&&(l=s.dehydrated,l!==null))return QA(e,n,o,r,l,s,t);if(i){i=r.fallback,o=n.mode,s=e.child,l=s.sibling;var c={mode:"hidden",children:r.children};return!(o&1)&&n.child!==s?(r=n.child,r.childLanes=0,r.pendingProps=c,n.deletions=null):(r=pt(s,c),r.subtreeFlags=s.subtreeFlags&14680064),l!==null?i=pt(l,i):(i=Pt(i,o,t,null),i.flags|=2),i.return=n,r.return=n,r.sibling=i,n.child=r,r=i,i=n.child,o=e.child.memoizedState,o=o===null?Ma(t):{baseLanes:o.baseLanes|t,cachePool:null,transitions:o.transitions},i.memoizedState=o,i.childLanes=e.childLanes&~t,n.memoizedState=Pa,r}return i=e.child,e=i.sibling,r=pt(i,{mode:"visible",children:r.children}),!(n.mode&1)&&(r.lanes=t),r.return=n,r.sibling=null,e!==null&&(t=n.deletions,t===null?(n.deletions=[e],n.flags|=16):t.push(e)),n.child=r,n.memoizedState=null,r}function Vl(e,n){return n=Zi({mode:"visible",children:n},e.mode,0,null),n.return=e,e.child=n}function Hs(e,n,t,r){return r!==null&&Ll(r),mr(n,e.child,null,t),e=Vl(n,n.pendingProps.children),e.flags|=2,n.memoizedState=null,e}function QA(e,n,t,r,s,i,o){if(t)return n.flags&256?(n.flags&=-257,r=To(Error(L(422))),Hs(e,n,o,r)):n.memoizedState!==null?(n.child=e.child,n.flags|=128,null):(i=r.fallback,s=n.mode,r=Zi({mode:"visible",children:r.children},s,0,null),i=Pt(i,s,o,null),i.flags|=2,r.return=n,i.return=n,r.sibling=i,n.child=r,n.mode&1&&mr(n,e.child,null,o),n.child.memoizedState=Ma(o),n.memoizedState=Pa,i);if(!(n.mode&1))return Hs(e,n,o,null);if(s.data==="$!"){if(r=s.nextSibling&&s.nextSibling.dataset,r)var l=r.dgst;return r=l,i=Error(L(419)),r=To(i,r,void 0),Hs(e,n,o,r)}if(l=(o&e.childLanes)!==0,Ve||l){if(r=ye,r!==null){switch(o&-o){case 4:s=2;break;case 16:s=8;break;case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:s=32;break;case 536870912:s=268435456;break;default:s=0}s=s&(r.suspendedLanes|o)?0:s,s!==0&&s!==i.retryLane&&(i.retryLane=s,Kn(e,s),yn(r,e,s,-1))}return Zl(),r=To(Error(L(421))),Hs(e,n,o,r)}return s.data==="$?"?(n.flags|=128,n.child=e.child,n=a1.bind(null,e),s._reactRetry=n,null):(e=i.treeContext,Ye=ct(s.nextSibling),Xe=n,oe=!0,vn=null,e!==null&&(sn[on++]=In,sn[on++]=On,sn[on++]=Bt,In=e.id,On=e.overflow,Bt=n),n=Vl(n,r.children),n.flags|=4096,n)}function kd(e,n,t){e.lanes|=n;var r=e.alternate;r!==null&&(r.lanes|=n),Ea(e.return,n,t)}function Ro(e,n,t,r,s){var i=e.memoizedState;i===null?e.memoizedState={isBackwards:n,rendering:null,renderingStartTime:0,last:r,tail:t,tailMode:s}:(i.isBackwards=n,i.rendering=null,i.renderingStartTime=0,i.last=r,i.tail=t,i.tailMode=s)}function Cp(e,n,t){var r=n.pendingProps,s=r.revealOrder,i=r.tail;if(De(e,n,r.children,t),r=ce.current,r&2)r=r&1|2,n.flags|=128;else{if(e!==null&&e.flags&128)e:for(e=n.child;e!==null;){if(e.tag===13)e.memoizedState!==null&&kd(e,t,n);else if(e.tag===19)kd(e,t,n);else if(e.child!==null){e.child.return=e,e=e.child;continue}if(e===n)break e;for(;e.sibling===null;){if(e.return===null||e.return===n)break e;e=e.return}e.sibling.return=e.return,e=e.sibling}r&=1}if(ee(ce,r),!(n.mode&1))n.memoizedState=null;else switch(s){case"forwards":for(t=n.child,s=null;t!==null;)e=t.alternate,e!==null&&Si(e)===null&&(s=t),t=t.sibling;t=s,t===null?(s=n.child,n.child=null):(s=t.sibling,t.sibling=null),Ro(n,!1,s,t,i);break;case"backwards":for(t=null,s=n.child,n.child=null;s!==null;){if(e=s.alternate,e!==null&&Si(e)===null){n.child=s;break}e=s.sibling,s.sibling=t,t=s,s=e}Ro(n,!0,t,null,i);break;case"together":Ro(n,!1,null,null,void 0);break;default:n.memoizedState=null}return n.child}function ri(e,n){!(n.mode&1)&&e!==null&&(e.alternate=null,n.alternate=null,n.flags|=2)}function _n(e,n,t){if(e!==null&&(n.dependencies=e.dependencies),Ft|=n.lanes,!(t&n.childLanes))return null;if(e!==null&&n.child!==e.child)throw Error(L(153));if(n.child!==null){for(e=n.child,t=pt(e,e.pendingProps),n.child=t,t.return=n;e.sibling!==null;)e=e.sibling,t=t.sibling=pt(e,e.pendingProps),t.return=n;t.sibling=null}return n.child}function ZA(e,n,t){switch(n.tag){case 3:yp(n),hr();break;case 5:Yf(n);break;case 1:_e(n.type)&&xi(n);break;case 4:Dl(n,n.stateNode.containerInfo);break;case 10:var r=n.type._context,s=n.memoizedProps.value;ee(yi,r._currentValue),r._currentValue=s;break;case 13:if(r=n.memoizedState,r!==null)return r.dehydrated!==null?(ee(ce,ce.current&1),n.flags|=128,null):t&n.child.childLanes?bp(e,n,t):(ee(ce,ce.current&1),e=_n(e,n,t),e!==null?e.sibling:null);ee(ce,ce.current&1);break;case 19:if(r=(t&n.childLanes)!==0,e.flags&128){if(r)return Cp(e,n,t);n.flags|=128}if(s=n.memoizedState,s!==null&&(s.rendering=null,s.tail=null,s.lastEffect=null),ee(ce,ce.current),r)break;return null;case 22:case 23:return n.lanes=0,kp(e,n,t)}return _n(e,n,t)}var Sp,Ba,Ep,jp;Sp=function(e,n){for(var t=n.child;t!==null;){if(t.tag===5||t.tag===6)e.appendChild(t.stateNode);else if(t.tag!==4&&t.child!==null){t.child.return=t,t=t.child;continue}if(t===n)break;for(;t.sibling===null;){if(t.return===null||t.return===n)return;t=t.return}t.sibling.return=t.return,t=t.sibling}};Ba=function(){};Ep=function(e,n,t,r){var s=e.memoizedProps;if(s!==r){e=n.stateNode,Lt(Mn.current);var i=null;switch(t){case"input":s=ta(e,s),r=ta(e,r),i=[];break;case"select":s=ue({},s,{value:void 0}),r=ue({},r,{value:void 0}),i=[];break;case"textarea":s=ia(e,s),r=ia(e,r),i=[];break;default:typeof s.onClick!="function"&&typeof r.onClick=="function"&&(e.onclick=gi)}aa(t,r);var o;t=null;for(d in s)if(!r.hasOwnProperty(d)&&s.hasOwnProperty(d)&&s[d]!=null)if(d==="style"){var l=s[d];for(o in l)l.hasOwnProperty(o)&&(t||(t={}),t[o]="")}else d!=="dangerouslySetInnerHTML"&&d!=="children"&&d!=="suppressContentEditableWarning"&&d!=="suppressHydrationWarning"&&d!=="autoFocus"&&(Jr.hasOwnProperty(d)?i||(i=[]):(i=i||[]).push(d,null));for(d in r){var c=r[d];if(l=s!=null?s[d]:void 0,r.hasOwnProperty(d)&&c!==l&&(c!=null||l!=null))if(d==="style")if(l){for(o in l)!l.hasOwnProperty(o)||c&&c.hasOwnProperty(o)||(t||(t={}),t[o]="");for(o in c)c.hasOwnProperty(o)&&l[o]!==c[o]&&(t||(t={}),t[o]=c[o])}else t||(i||(i=[]),i.push(d,t)),t=c;else d==="dangerouslySetInnerHTML"?(c=c?c.__html:void 0,l=l?l.__html:void 0,c!=null&&l!==c&&(i=i||[]).push(d,c)):d==="children"?typeof c!="string"&&typeof c!="number"||(i=i||[]).push(d,""+c):d!=="suppressContentEditableWarning"&&d!=="suppressHydrationWarning"&&(Jr.hasOwnProperty(d)?(c!=null&&d==="onScroll"&&te("scroll",e),i||l===c||(i=[])):(i=i||[]).push(d,c))}t&&(i=i||[]).push("style",t);var d=i;(n.updateQueue=d)&&(n.flags|=4)}};jp=function(e,n,t,r){t!==r&&(n.flags|=4)};function Br(e,n){if(!oe)switch(e.tailMode){case"hidden":n=e.tail;for(var t=null;n!==null;)n.alternate!==null&&(t=n),n=n.sibling;t===null?e.tail=null:t.sibling=null;break;case"collapsed":t=e.tail;for(var r=null;t!==null;)t.alternate!==null&&(r=t),t=t.sibling;r===null?n||e.tail===null?e.tail=null:e.tail.sibling=null:r.sibling=null}}function Ne(e){var n=e.alternate!==null&&e.alternate.child===e.child,t=0,r=0;if(n)for(var s=e.child;s!==null;)t|=s.lanes|s.childLanes,r|=s.subtreeFlags&14680064,r|=s.flags&14680064,s.return=e,s=s.sibling;else for(s=e.child;s!==null;)t|=s.lanes|s.childLanes,r|=s.subtreeFlags,r|=s.flags,s.return=e,s=s.sibling;return e.subtreeFlags|=r,e.childLanes=t,n}function YA(e,n,t){var r=n.pendingProps;switch(Nl(n),n.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return Ne(n),null;case 1:return _e(n.type)&&vi(),Ne(n),null;case 3:return r=n.stateNode,Ar(),re(Ke),re(Pe),Il(),r.pendingContext&&(r.context=r.pendingContext,r.pendingContext=null),(e===null||e.child===null)&&(Is(n)?n.flags|=4:e===null||e.memoizedState.isDehydrated&&!(n.flags&256)||(n.flags|=1024,vn!==null&&(Wa(vn),vn=null))),Ba(e,n),Ne(n),null;case 5:Fl(n);var s=Lt(ds.current);if(t=n.type,e!==null&&n.stateNode!=null)Ep(e,n,t,r,s),e.ref!==n.ref&&(n.flags|=512,n.flags|=2097152);else{if(!r){if(n.stateNode===null)throw Error(L(166));return Ne(n),null}if(e=Lt(Mn.current),Is(n)){r=n.stateNode,t=n.type;var i=n.memoizedProps;switch(r[Rn]=n,r[ls]=i,e=(n.mode&1)!==0,t){case"dialog":te("cancel",r),te("close",r);break;case"iframe":case"object":case"embed":te("load",r);break;case"video":case"audio":for(s=0;s<Hr.length;s++)te(Hr[s],r);break;case"source":te("error",r);break;case"img":case"image":case"link":te("error",r),te("load",r);break;case"details":te("toggle",r);break;case"input":Lc(r,i),te("invalid",r);break;case"select":r._wrapperState={wasMultiple:!!i.multiple},te("invalid",r);break;case"textarea":Rc(r,i),te("invalid",r)}aa(t,i),s=null;for(var o in i)if(i.hasOwnProperty(o)){var l=i[o];o==="children"?typeof l=="string"?r.textContent!==l&&(i.suppressHydrationWarning!==!0&&Fs(r.textContent,l,e),s=["children",l]):typeof l=="number"&&r.textContent!==""+l&&(i.suppressHydrationWarning!==!0&&Fs(r.textContent,l,e),s=["children",""+l]):Jr.hasOwnProperty(o)&&l!=null&&o==="onScroll"&&te("scroll",r)}switch(t){case"input":Ns(r),Tc(r,i,!0);break;case"textarea":Ns(r),Pc(r);break;case"select":case"option":break;default:typeof i.onClick=="function"&&(r.onclick=gi)}r=s,n.updateQueue=r,r!==null&&(n.flags|=4)}else{o=s.nodeType===9?s:s.ownerDocument,e==="http://www.w3.org/1999/xhtml"&&(e=ef(t)),e==="http://www.w3.org/1999/xhtml"?t==="script"?(e=o.createElement("div"),e.innerHTML="<script><\/script>",e=e.removeChild(e.firstChild)):typeof r.is=="string"?e=o.createElement(t,{is:r.is}):(e=o.createElement(t),t==="select"&&(o=e,r.multiple?o.multiple=!0:r.size&&(o.size=r.size))):e=o.createElementNS(e,t),e[Rn]=n,e[ls]=r,Sp(e,n,!1,!1),n.stateNode=e;e:{switch(o=la(t,r),t){case"dialog":te("cancel",e),te("close",e),s=r;break;case"iframe":case"object":case"embed":te("load",e),s=r;break;case"video":case"audio":for(s=0;s<Hr.length;s++)te(Hr[s],e);s=r;break;case"source":te("error",e),s=r;break;case"img":case"image":case"link":te("error",e),te("load",e),s=r;break;case"details":te("toggle",e),s=r;break;case"input":Lc(e,r),s=ta(e,r),te("invalid",e);break;case"option":s=r;break;case"select":e._wrapperState={wasMultiple:!!r.multiple},s=ue({},r,{value:void 0}),te("invalid",e);break;case"textarea":Rc(e,r),s=ia(e,r),te("invalid",e);break;default:s=r}aa(t,s),l=s;for(i in l)if(l.hasOwnProperty(i)){var c=l[i];i==="style"?rf(e,c):i==="dangerouslySetInnerHTML"?(c=c?c.__html:void 0,c!=null&&nf(e,c)):i==="children"?typeof c=="string"?(t!=="textarea"||c!=="")&&$r(e,c):typeof c=="number"&&$r(e,""+c):i!=="suppressContentEditableWarning"&&i!=="suppressHydrationWarning"&&i!=="autoFocus"&&(Jr.hasOwnProperty(i)?c!=null&&i==="onScroll"&&te("scroll",e):c!=null&&pl(e,i,c,o))}switch(t){case"input":Ns(e),Tc(e,r,!1);break;case"textarea":Ns(e),Pc(e);break;case"option":r.value!=null&&e.setAttribute("value",""+At(r.value));break;case"select":e.multiple=!!r.multiple,i=r.value,i!=null?ir(e,!!r.multiple,i,!1):r.defaultValue!=null&&ir(e,!!r.multiple,r.defaultValue,!0);break;default:typeof s.onClick=="function"&&(e.onclick=gi)}switch(t){case"button":case"input":case"select":case"textarea":r=!!r.autoFocus;break e;case"img":r=!0;break e;default:r=!1}}r&&(n.flags|=4)}n.ref!==null&&(n.flags|=512,n.flags|=2097152)}return Ne(n),null;case 6:if(e&&n.stateNode!=null)jp(e,n,e.memoizedProps,r);else{if(typeof r!="string"&&n.stateNode===null)throw Error(L(166));if(t=Lt(ds.current),Lt(Mn.current),Is(n)){if(r=n.stateNode,t=n.memoizedProps,r[Rn]=n,(i=r.nodeValue!==t)&&(e=Xe,e!==null))switch(e.tag){case 3:Fs(r.nodeValue,t,(e.mode&1)!==0);break;case 5:e.memoizedProps.suppressHydrationWarning!==!0&&Fs(r.nodeValue,t,(e.mode&1)!==0)}i&&(n.flags|=4)}else r=(t.nodeType===9?t:t.ownerDocument).createTextNode(r),r[Rn]=n,n.stateNode=r}return Ne(n),null;case 13:if(re(ce),r=n.memoizedState,e===null||e.memoizedState!==null&&e.memoizedState.dehydrated!==null){if(oe&&Ye!==null&&n.mode&1&&!(n.flags&128))_f(),hr(),n.flags|=98560,i=!1;else if(i=Is(n),r!==null&&r.dehydrated!==null){if(e===null){if(!i)throw Error(L(318));if(i=n.memoizedState,i=i!==null?i.dehydrated:null,!i)throw Error(L(317));i[Rn]=n}else hr(),!(n.flags&128)&&(n.memoizedState=null),n.flags|=4;Ne(n),i=!1}else vn!==null&&(Wa(vn),vn=null),i=!0;if(!i)return n.flags&65536?n:null}return n.flags&128?(n.lanes=t,n):(r=r!==null,r!==(e!==null&&e.memoizedState!==null)&&r&&(n.child.flags|=8192,n.mode&1&&(e===null||ce.current&1?xe===0&&(xe=3):Zl())),n.updateQueue!==null&&(n.flags|=4),Ne(n),null);case 4:return Ar(),Ba(e,n),e===null&&os(n.stateNode.containerInfo),Ne(n),null;case 10:return Pl(n.type._context),Ne(n),null;case 17:return _e(n.type)&&vi(),Ne(n),null;case 19:if(re(ce),i=n.memoizedState,i===null)return Ne(n),null;if(r=(n.flags&128)!==0,o=i.rendering,o===null)if(r)Br(i,!1);else{if(xe!==0||e!==null&&e.flags&128)for(e=n.child;e!==null;){if(o=Si(e),o!==null){for(n.flags|=128,Br(i,!1),r=o.updateQueue,r!==null&&(n.updateQueue=r,n.flags|=4),n.subtreeFlags=0,r=t,t=n.child;t!==null;)i=t,e=r,i.flags&=14680066,o=i.alternate,o===null?(i.childLanes=0,i.lanes=e,i.child=null,i.subtreeFlags=0,i.memoizedProps=null,i.memoizedState=null,i.updateQueue=null,i.dependencies=null,i.stateNode=null):(i.childLanes=o.childLanes,i.lanes=o.lanes,i.child=o.child,i.subtreeFlags=0,i.deletions=null,i.memoizedProps=o.memoizedProps,i.memoizedState=o.memoizedState,i.updateQueue=o.updateQueue,i.type=o.type,e=o.dependencies,i.dependencies=e===null?null:{lanes:e.lanes,firstContext:e.firstContext}),t=t.sibling;return ee(ce,ce.current&1|2),n.child}e=e.sibling}i.tail!==null&&he()>vr&&(n.flags|=128,r=!0,Br(i,!1),n.lanes=4194304)}else{if(!r)if(e=Si(o),e!==null){if(n.flags|=128,r=!0,t=e.updateQueue,t!==null&&(n.updateQueue=t,n.flags|=4),Br(i,!0),i.tail===null&&i.tailMode==="hidden"&&!o.alternate&&!oe)return Ne(n),null}else 2*he()-i.renderingStartTime>vr&&t!==1073741824&&(n.flags|=128,r=!0,Br(i,!1),n.lanes=4194304);i.isBackwards?(o.sibling=n.child,n.child=o):(t=i.last,t!==null?t.sibling=o:n.child=o,i.last=o)}return i.tail!==null?(n=i.tail,i.rendering=n,i.tail=n.sibling,i.renderingStartTime=he(),n.sibling=null,t=ce.current,ee(ce,r?t&1|2:t&1),n):(Ne(n),null);case 22:case 23:return Ql(),r=n.memoizedState!==null,e!==null&&e.memoizedState!==null!==r&&(n.flags|=8192),r&&n.mode&1?Ze&1073741824&&(Ne(n),n.subtreeFlags&6&&(n.flags|=8192)):Ne(n),null;case 24:return null;case 25:return null}throw Error(L(156,n.tag))}function XA(e,n){switch(Nl(n),n.tag){case 1:return _e(n.type)&&vi(),e=n.flags,e&65536?(n.flags=e&-65537|128,n):null;case 3:return Ar(),re(Ke),re(Pe),Il(),e=n.flags,e&65536&&!(e&128)?(n.flags=e&-65537|128,n):null;case 5:return Fl(n),null;case 13:if(re(ce),e=n.memoizedState,e!==null&&e.dehydrated!==null){if(n.alternate===null)throw Error(L(340));hr()}return e=n.flags,e&65536?(n.flags=e&-65537|128,n):null;case 19:return re(ce),null;case 4:return Ar(),null;case 10:return Pl(n.type._context),null;case 22:case 23:return Ql(),null;case 24:return null;default:return null}}var zs=!1,Re=!1,JA=typeof WeakSet=="function"?WeakSet:Set,H=null;function rr(e,n){var t=e.ref;if(t!==null)if(typeof t=="function")try{t(null)}catch(r){pe(e,n,r)}else t.current=null}function Da(e,n,t){try{t()}catch(r){pe(e,n,r)}}var wd=!1;function $A(e,n){if(va=hi,e=Pf(),El(e)){if("selectionStart"in e)var t={start:e.selectionStart,end:e.selectionEnd};else e:{t=(t=e.ownerDocument)&&t.defaultView||window;var r=t.getSelection&&t.getSelection();if(r&&r.rangeCount!==0){t=r.anchorNode;var s=r.anchorOffset,i=r.focusNode;r=r.focusOffset;try{t.nodeType,i.nodeType}catch{t=null;break e}var o=0,l=-1,c=-1,d=0,u=0,f=e,p=null;n:for(;;){for(var A;f!==t||s!==0&&f.nodeType!==3||(l=o+s),f!==i||r!==0&&f.nodeType!==3||(c=o+r),f.nodeType===3&&(o+=f.nodeValue.length),(A=f.firstChild)!==null;)p=f,f=A;for(;;){if(f===e)break n;if(p===t&&++d===s&&(l=o),p===i&&++u===r&&(c=o),(A=f.nextSibling)!==null)break;f=p,p=f.parentNode}f=A}t=l===-1||c===-1?null:{start:l,end:c}}else t=null}t=t||{start:0,end:0}}else t=null;for(xa={focusedElem:e,selectionRange:t},hi=!1,H=n;H!==null;)if(n=H,e=n.child,(n.subtreeFlags&1028)!==0&&e!==null)e.return=n,H=e;else for(;H!==null;){n=H;try{var v=n.alternate;if(n.flags&1024)switch(n.tag){case 0:case 11:case 15:break;case 1:if(v!==null){var x=v.memoizedProps,w=v.memoizedState,g=n.stateNode,m=g.getSnapshotBeforeUpdate(n.elementType===n.type?x:An(n.type,x),w);g.__reactInternalSnapshotBeforeUpdate=m}break;case 3:var k=n.stateNode.containerInfo;k.nodeType===1?k.textContent="":k.nodeType===9&&k.documentElement&&k.removeChild(k.documentElement);break;case 5:case 6:case 4:case 17:break;default:throw Error(L(163))}}catch(b){pe(n,n.return,b)}if(e=n.sibling,e!==null){e.return=n.return,H=e;break}H=n.return}return v=wd,wd=!1,v}function Qr(e,n,t){var r=n.updateQueue;if(r=r!==null?r.lastEffect:null,r!==null){var s=r=r.next;do{if((s.tag&e)===e){var i=s.destroy;s.destroy=void 0,i!==void 0&&Da(n,t,i)}s=s.next}while(s!==r)}}function qi(e,n){if(n=n.updateQueue,n=n!==null?n.lastEffect:null,n!==null){var t=n=n.next;do{if((t.tag&e)===e){var r=t.create;t.destroy=r()}t=t.next}while(t!==n)}}function Fa(e){var n=e.ref;if(n!==null){var t=e.stateNode;switch(e.tag){case 5:e=t;break;default:e=t}typeof n=="function"?n(e):n.current=e}}function Np(e){var n=e.alternate;n!==null&&(e.alternate=null,Np(n)),e.child=null,e.deletions=null,e.sibling=null,e.tag===5&&(n=e.stateNode,n!==null&&(delete n[Rn],delete n[ls],delete n[ya],delete n[DA],delete n[FA])),e.stateNode=null,e.return=null,e.dependencies=null,e.memoizedProps=null,e.memoizedState=null,e.pendingProps=null,e.stateNode=null,e.updateQueue=null}function Lp(e){return e.tag===5||e.tag===3||e.tag===4}function yd(e){e:for(;;){for(;e.sibling===null;){if(e.return===null||Lp(e.return))return null;e=e.return}for(e.sibling.return=e.return,e=e.sibling;e.tag!==5&&e.tag!==6&&e.tag!==18;){if(e.flags&2||e.child===null||e.tag===4)continue e;e.child.return=e,e=e.child}if(!(e.flags&2))return e.stateNode}}function Ia(e,n,t){var r=e.tag;if(r===5||r===6)e=e.stateNode,n?t.nodeType===8?t.parentNode.insertBefore(e,n):t.insertBefore(e,n):(t.nodeType===8?(n=t.parentNode,n.insertBefore(e,t)):(n=t,n.appendChild(e)),t=t._reactRootContainer,t!=null||n.onclick!==null||(n.onclick=gi));else if(r!==4&&(e=e.child,e!==null))for(Ia(e,n,t),e=e.sibling;e!==null;)Ia(e,n,t),e=e.sibling}function Oa(e,n,t){var r=e.tag;if(r===5||r===6)e=e.stateNode,n?t.insertBefore(e,n):t.appendChild(e);else if(r!==4&&(e=e.child,e!==null))for(Oa(e,n,t),e=e.sibling;e!==null;)Oa(e,n,t),e=e.sibling}var be=null,gn=!1;function Xn(e,n,t){for(t=t.child;t!==null;)Tp(e,n,t),t=t.sibling}function Tp(e,n,t){if(Pn&&typeof Pn.onCommitFiberUnmount=="function")try{Pn.onCommitFiberUnmount(Hi,t)}catch{}switch(t.tag){case 5:Re||rr(t,n);case 6:var r=be,s=gn;be=null,Xn(e,n,t),be=r,gn=s,be!==null&&(gn?(e=be,t=t.stateNode,e.nodeType===8?e.parentNode.removeChild(t):e.removeChild(t)):be.removeChild(t.stateNode));break;case 18:be!==null&&(gn?(e=be,t=t.stateNode,e.nodeType===8?Co(e.parentNode,t):e.nodeType===1&&Co(e,t),rs(e)):Co(be,t.stateNode));break;case 4:r=be,s=gn,be=t.stateNode.containerInfo,gn=!0,Xn(e,n,t),be=r,gn=s;break;case 0:case 11:case 14:case 15:if(!Re&&(r=t.updateQueue,r!==null&&(r=r.lastEffect,r!==null))){s=r=r.next;do{var i=s,o=i.destroy;i=i.tag,o!==void 0&&(i&2||i&4)&&Da(t,n,o),s=s.next}while(s!==r)}Xn(e,n,t);break;case 1:if(!Re&&(rr(t,n),r=t.stateNode,typeof r.componentWillUnmount=="function"))try{r.props=t.memoizedProps,r.state=t.memoizedState,r.componentWillUnmount()}catch(l){pe(t,n,l)}Xn(e,n,t);break;case 21:Xn(e,n,t);break;case 22:t.mode&1?(Re=(r=Re)||t.memoizedState!==null,Xn(e,n,t),Re=r):Xn(e,n,t);break;default:Xn(e,n,t)}}function bd(e){var n=e.updateQueue;if(n!==null){e.updateQueue=null;var t=e.stateNode;t===null&&(t=e.stateNode=new JA),n.forEach(function(r){var s=l1.bind(null,e,r);t.has(r)||(t.add(r),r.then(s,s))})}}function hn(e,n){var t=n.deletions;if(t!==null)for(var r=0;r<t.length;r++){var s=t[r];try{var i=e,o=n,l=o;e:for(;l!==null;){switch(l.tag){case 5:be=l.stateNode,gn=!1;break e;case 3:be=l.stateNode.containerInfo,gn=!0;break e;case 4:be=l.stateNode.containerInfo,gn=!0;break e}l=l.return}if(be===null)throw Error(L(160));Tp(i,o,s),be=null,gn=!1;var c=s.alternate;c!==null&&(c.return=null),s.return=null}catch(d){pe(s,n,d)}}if(n.subtreeFlags&12854)for(n=n.child;n!==null;)Rp(n,e),n=n.sibling}function Rp(e,n){var t=e.alternate,r=e.flags;switch(e.tag){case 0:case 11:case 14:case 15:if(hn(n,e),jn(e),r&4){try{Qr(3,e,e.return),qi(3,e)}catch(x){pe(e,e.return,x)}try{Qr(5,e,e.return)}catch(x){pe(e,e.return,x)}}break;case 1:hn(n,e),jn(e),r&512&&t!==null&&rr(t,t.return);break;case 5:if(hn(n,e),jn(e),r&512&&t!==null&&rr(t,t.return),e.flags&32){var s=e.stateNode;try{$r(s,"")}catch(x){pe(e,e.return,x)}}if(r&4&&(s=e.stateNode,s!=null)){var i=e.memoizedProps,o=t!==null?t.memoizedProps:i,l=e.type,c=e.updateQueue;if(e.updateQueue=null,c!==null)try{l==="input"&&i.type==="radio"&&i.name!=null&&Ju(s,i),la(l,o);var d=la(l,i);for(o=0;o<c.length;o+=2){var u=c[o],f=c[o+1];u==="style"?rf(s,f):u==="dangerouslySetInnerHTML"?nf(s,f):u==="children"?$r(s,f):pl(s,u,f,d)}switch(l){case"input":ra(s,i);break;case"textarea":$u(s,i);break;case"select":var p=s._wrapperState.wasMultiple;s._wrapperState.wasMultiple=!!i.multiple;var A=i.value;A!=null?ir(s,!!i.multiple,A,!1):p!==!!i.multiple&&(i.defaultValue!=null?ir(s,!!i.multiple,i.defaultValue,!0):ir(s,!!i.multiple,i.multiple?[]:"",!1))}s[ls]=i}catch(x){pe(e,e.return,x)}}break;case 6:if(hn(n,e),jn(e),r&4){if(e.stateNode===null)throw Error(L(162));s=e.stateNode,i=e.memoizedProps;try{s.nodeValue=i}catch(x){pe(e,e.return,x)}}break;case 3:if(hn(n,e),jn(e),r&4&&t!==null&&t.memoizedState.isDehydrated)try{rs(n.containerInfo)}catch(x){pe(e,e.return,x)}break;case 4:hn(n,e),jn(e);break;case 13:hn(n,e),jn(e),s=e.child,s.flags&8192&&(i=s.memoizedState!==null,s.stateNode.isHidden=i,!i||s.alternate!==null&&s.alternate.memoizedState!==null||(Gl=he())),r&4&&bd(e);break;case 22:if(u=t!==null&&t.memoizedState!==null,e.mode&1?(Re=(d=Re)||u,hn(n,e),Re=d):hn(n,e),jn(e),r&8192){if(d=e.memoizedState!==null,(e.stateNode.isHidden=d)&&!u&&e.mode&1)for(H=e,u=e.child;u!==null;){for(f=H=u;H!==null;){switch(p=H,A=p.child,p.tag){case 0:case 11:case 14:case 15:Qr(4,p,p.return);break;case 1:rr(p,p.return);var v=p.stateNode;if(typeof v.componentWillUnmount=="function"){r=p,t=p.return;try{n=r,v.props=n.memoizedProps,v.state=n.memoizedState,v.componentWillUnmount()}catch(x){pe(r,t,x)}}break;case 5:rr(p,p.return);break;case 22:if(p.memoizedState!==null){Sd(f);continue}}A!==null?(A.return=p,H=A):Sd(f)}u=u.sibling}e:for(u=null,f=e;;){if(f.tag===5){if(u===null){u=f;try{s=f.stateNode,d?(i=s.style,typeof i.setProperty=="function"?i.setProperty("display","none","important"):i.display="none"):(l=f.stateNode,c=f.memoizedProps.style,o=c!=null&&c.hasOwnProperty("display")?c.display:null,l.style.display=tf("display",o))}catch(x){pe(e,e.return,x)}}}else if(f.tag===6){if(u===null)try{f.stateNode.nodeValue=d?"":f.memoizedProps}catch(x){pe(e,e.return,x)}}else if((f.tag!==22&&f.tag!==23||f.memoizedState===null||f===e)&&f.child!==null){f.child.return=f,f=f.child;continue}if(f===e)break e;for(;f.sibling===null;){if(f.return===null||f.return===e)break e;u===f&&(u=null),f=f.return}u===f&&(u=null),f.sibling.return=f.return,f=f.sibling}}break;case 19:hn(n,e),jn(e),r&4&&bd(e);break;case 21:break;default:hn(n,e),jn(e)}}function jn(e){var n=e.flags;if(n&2){try{e:{for(var t=e.return;t!==null;){if(Lp(t)){var r=t;break e}t=t.return}throw Error(L(160))}switch(r.tag){case 5:var s=r.stateNode;r.flags&32&&($r(s,""),r.flags&=-33);var i=yd(e);Oa(e,i,s);break;case 3:case 4:var o=r.stateNode.containerInfo,l=yd(e);Ia(e,l,o);break;default:throw Error(L(161))}}catch(c){pe(e,e.return,c)}e.flags&=-3}n&4096&&(e.flags&=-4097)}function e1(e,n,t){H=e,Pp(e)}function Pp(e,n,t){for(var r=(e.mode&1)!==0;H!==null;){var s=H,i=s.child;if(s.tag===22&&r){var o=s.memoizedState!==null||zs;if(!o){var l=s.alternate,c=l!==null&&l.memoizedState!==null||Re;l=zs;var d=Re;if(zs=o,(Re=c)&&!d)for(H=s;H!==null;)o=H,c=o.child,o.tag===22&&o.memoizedState!==null?Ed(s):c!==null?(c.return=o,H=c):Ed(s);for(;i!==null;)H=i,Pp(i),i=i.sibling;H=s,zs=l,Re=d}Cd(e)}else s.subtreeFlags&8772&&i!==null?(i.return=s,H=i):Cd(e)}}function Cd(e){for(;H!==null;){var n=H;if(n.flags&8772){var t=n.alternate;try{if(n.flags&8772)switch(n.tag){case 0:case 11:case 15:Re||qi(5,n);break;case 1:var r=n.stateNode;if(n.flags&4&&!Re)if(t===null)r.componentDidMount();else{var s=n.elementType===n.type?t.memoizedProps:An(n.type,t.memoizedProps);r.componentDidUpdate(s,t.memoizedState,r.__reactInternalSnapshotBeforeUpdate)}var i=n.updateQueue;i!==null&&ld(n,i,r);break;case 3:var o=n.updateQueue;if(o!==null){if(t=null,n.child!==null)switch(n.child.tag){case 5:t=n.child.stateNode;break;case 1:t=n.child.stateNode}ld(n,o,t)}break;case 5:var l=n.stateNode;if(t===null&&n.flags&4){t=l;var c=n.memoizedProps;switch(n.type){case"button":case"input":case"select":case"textarea":c.autoFocus&&t.focus();break;case"img":c.src&&(t.src=c.src)}}break;case 6:break;case 4:break;case 12:break;case 13:if(n.memoizedState===null){var d=n.alternate;if(d!==null){var u=d.memoizedState;if(u!==null){var f=u.dehydrated;f!==null&&rs(f)}}}break;case 19:case 17:case 21:case 22:case 23:case 25:break;default:throw Error(L(163))}Re||n.flags&512&&Fa(n)}catch(p){pe(n,n.return,p)}}if(n===e){H=null;break}if(t=n.sibling,t!==null){t.return=n.return,H=t;break}H=n.return}}function Sd(e){for(;H!==null;){var n=H;if(n===e){H=null;break}var t=n.sibling;if(t!==null){t.return=n.return,H=t;break}H=n.return}}function Ed(e){for(;H!==null;){var n=H;try{switch(n.tag){case 0:case 11:case 15:var t=n.return;try{qi(4,n)}catch(c){pe(n,t,c)}break;case 1:var r=n.stateNode;if(typeof r.componentDidMount=="function"){var s=n.return;try{r.componentDidMount()}catch(c){pe(n,s,c)}}var i=n.return;try{Fa(n)}catch(c){pe(n,i,c)}break;case 5:var o=n.return;try{Fa(n)}catch(c){pe(n,o,c)}}}catch(c){pe(n,n.return,c)}if(n===e){H=null;break}var l=n.sibling;if(l!==null){l.return=n.return,H=l;break}H=n.return}}var n1=Math.ceil,Ni=qn.ReactCurrentDispatcher,Kl=qn.ReactCurrentOwner,ln=qn.ReactCurrentBatchConfig,Q=0,ye=null,me=null,Ce=0,Ze=0,sr=xt(0),xe=0,hs=null,Ft=0,Qi=0,_l=0,Zr=null,We=null,Gl=0,vr=1/0,Dn=null,Li=!1,Ha=null,ut=null,Us=!1,st=null,Ti=0,Yr=0,za=null,si=-1,ii=0;function Ie(){return Q&6?he():si!==-1?si:si=he()}function ft(e){return e.mode&1?Q&2&&Ce!==0?Ce&-Ce:OA.transition!==null?(ii===0&&(ii=Af()),ii):(e=X,e!==0||(e=window.event,e=e===void 0?16:bf(e.type)),e):1}function yn(e,n,t,r){if(50<Yr)throw Yr=0,za=null,Error(L(185));xs(e,t,r),(!(Q&2)||e!==ye)&&(e===ye&&(!(Q&2)&&(Qi|=t),xe===4&&tt(e,Ce)),Ge(e,r),t===1&&Q===0&&!(n.mode&1)&&(vr=he()+500,Ki&&kt()))}function Ge(e,n){var t=e.callbackNode;Om(e,n);var r=pi(e,e===ye?Ce:0);if(r===0)t!==null&&Dc(t),e.callbackNode=null,e.callbackPriority=0;else if(n=r&-r,e.callbackPriority!==n){if(t!=null&&Dc(t),n===1)e.tag===0?IA(jd.bind(null,e)):Wf(jd.bind(null,e)),MA(function(){!(Q&6)&&kt()}),t=null;else{switch(gf(r)){case 1:t=vl;break;case 4:t=hf;break;case 16:t=fi;break;case 536870912:t=mf;break;default:t=fi}t=zp(t,Mp.bind(null,e))}e.callbackPriority=n,e.callbackNode=t}}function Mp(e,n){if(si=-1,ii=0,Q&6)throw Error(L(327));var t=e.callbackNode;if(dr()&&e.callbackNode!==t)return null;var r=pi(e,e===ye?Ce:0);if(r===0)return null;if(r&30||r&e.expiredLanes||n)n=Ri(e,r);else{n=r;var s=Q;Q|=2;var i=Dp();(ye!==e||Ce!==n)&&(Dn=null,vr=he()+500,Rt(e,n));do try{s1();break}catch(l){Bp(e,l)}while(!0);Rl(),Ni.current=i,Q=s,me!==null?n=0:(ye=null,Ce=0,n=xe)}if(n!==0){if(n===2&&(s=pa(e),s!==0&&(r=s,n=Ua(e,s))),n===1)throw t=hs,Rt(e,0),tt(e,r),Ge(e,he()),t;if(n===6)tt(e,r);else{if(s=e.current.alternate,!(r&30)&&!t1(s)&&(n=Ri(e,r),n===2&&(i=pa(e),i!==0&&(r=i,n=Ua(e,i))),n===1))throw t=hs,Rt(e,0),tt(e,r),Ge(e,he()),t;switch(e.finishedWork=s,e.finishedLanes=r,n){case 0:case 1:throw Error(L(345));case 2:St(e,We,Dn);break;case 3:if(tt(e,r),(r&130023424)===r&&(n=Gl+500-he(),10<n)){if(pi(e,0)!==0)break;if(s=e.suspendedLanes,(s&r)!==r){Ie(),e.pingedLanes|=e.suspendedLanes&s;break}e.timeoutHandle=wa(St.bind(null,e,We,Dn),n);break}St(e,We,Dn);break;case 4:if(tt(e,r),(r&4194240)===r)break;for(n=e.eventTimes,s=-1;0<r;){var o=31-wn(r);i=1<<o,o=n[o],o>s&&(s=o),r&=~i}if(r=s,r=he()-r,r=(120>r?120:480>r?480:1080>r?1080:1920>r?1920:3e3>r?3e3:4320>r?4320:1960*n1(r/1960))-r,10<r){e.timeoutHandle=wa(St.bind(null,e,We,Dn),r);break}St(e,We,Dn);break;case 5:St(e,We,Dn);break;default:throw Error(L(329))}}}return Ge(e,he()),e.callbackNode===t?Mp.bind(null,e):null}function Ua(e,n){var t=Zr;return e.current.memoizedState.isDehydrated&&(Rt(e,n).flags|=256),e=Ri(e,n),e!==2&&(n=We,We=t,n!==null&&Wa(n)),e}function Wa(e){We===null?We=e:We.push.apply(We,e)}function t1(e){for(var n=e;;){if(n.flags&16384){var t=n.updateQueue;if(t!==null&&(t=t.stores,t!==null))for(var r=0;r<t.length;r++){var s=t[r],i=s.getSnapshot;s=s.value;try{if(!bn(i(),s))return!1}catch{return!1}}}if(t=n.child,n.subtreeFlags&16384&&t!==null)t.return=n,n=t;else{if(n===e)break;for(;n.sibling===null;){if(n.return===null||n.return===e)return!0;n=n.return}n.sibling.return=n.return,n=n.sibling}}return!0}function tt(e,n){for(n&=~_l,n&=~Qi,e.suspendedLanes|=n,e.pingedLanes&=~n,e=e.expirationTimes;0<n;){var t=31-wn(n),r=1<<t;e[t]=-1,n&=~r}}function jd(e){if(Q&6)throw Error(L(327));dr();var n=pi(e,0);if(!(n&1))return Ge(e,he()),null;var t=Ri(e,n);if(e.tag!==0&&t===2){var r=pa(e);r!==0&&(n=r,t=Ua(e,r))}if(t===1)throw t=hs,Rt(e,0),tt(e,n),Ge(e,he()),t;if(t===6)throw Error(L(345));return e.finishedWork=e.current.alternate,e.finishedLanes=n,St(e,We,Dn),Ge(e,he()),null}function ql(e,n){var t=Q;Q|=1;try{return e(n)}finally{Q=t,Q===0&&(vr=he()+500,Ki&&kt())}}function It(e){st!==null&&st.tag===0&&!(Q&6)&&dr();var n=Q;Q|=1;var t=ln.transition,r=X;try{if(ln.transition=null,X=1,e)return e()}finally{X=r,ln.transition=t,Q=n,!(Q&6)&&kt()}}function Ql(){Ze=sr.current,re(sr)}function Rt(e,n){e.finishedWork=null,e.finishedLanes=0;var t=e.timeoutHandle;if(t!==-1&&(e.timeoutHandle=-1,PA(t)),me!==null)for(t=me.return;t!==null;){var r=t;switch(Nl(r),r.tag){case 1:r=r.type.childContextTypes,r!=null&&vi();break;case 3:Ar(),re(Ke),re(Pe),Il();break;case 5:Fl(r);break;case 4:Ar();break;case 13:re(ce);break;case 19:re(ce);break;case 10:Pl(r.type._context);break;case 22:case 23:Ql()}t=t.return}if(ye=e,me=e=pt(e.current,null),Ce=Ze=n,xe=0,hs=null,_l=Qi=Ft=0,We=Zr=null,Nt!==null){for(n=0;n<Nt.length;n++)if(t=Nt[n],r=t.interleaved,r!==null){t.interleaved=null;var s=r.next,i=t.pending;if(i!==null){var o=i.next;i.next=s,r.next=o}t.pending=r}Nt=null}return e}function Bp(e,n){do{var t=me;try{if(Rl(),ni.current=ji,Ei){for(var r=de.memoizedState;r!==null;){var s=r.queue;s!==null&&(s.pending=null),r=r.next}Ei=!1}if(Dt=0,we=ve=de=null,qr=!1,us=0,Kl.current=null,t===null||t.return===null){xe=1,hs=n,me=null;break}e:{var i=e,o=t.return,l=t,c=n;if(n=Ce,l.flags|=32768,c!==null&&typeof c=="object"&&typeof c.then=="function"){var d=c,u=l,f=u.tag;if(!(u.mode&1)&&(f===0||f===11||f===15)){var p=u.alternate;p?(u.updateQueue=p.updateQueue,u.memoizedState=p.memoizedState,u.lanes=p.lanes):(u.updateQueue=null,u.memoizedState=null)}var A=hd(o);if(A!==null){A.flags&=-257,md(A,o,l,i,n),A.mode&1&&pd(i,d,n),n=A,c=d;var v=n.updateQueue;if(v===null){var x=new Set;x.add(c),n.updateQueue=x}else v.add(c);break e}else{if(!(n&1)){pd(i,d,n),Zl();break e}c=Error(L(426))}}else if(oe&&l.mode&1){var w=hd(o);if(w!==null){!(w.flags&65536)&&(w.flags|=256),md(w,o,l,i,n),Ll(gr(c,l));break e}}i=c=gr(c,l),xe!==4&&(xe=2),Zr===null?Zr=[i]:Zr.push(i),i=o;do{switch(i.tag){case 3:i.flags|=65536,n&=-n,i.lanes|=n;var g=gp(i,c,n);ad(i,g);break e;case 1:l=c;var m=i.type,k=i.stateNode;if(!(i.flags&128)&&(typeof m.getDerivedStateFromError=="function"||k!==null&&typeof k.componentDidCatch=="function"&&(ut===null||!ut.has(k)))){i.flags|=65536,n&=-n,i.lanes|=n;var b=vp(i,l,n);ad(i,b);break e}}i=i.return}while(i!==null)}Ip(t)}catch(y){n=y,me===t&&t!==null&&(me=t=t.return);continue}break}while(!0)}function Dp(){var e=Ni.current;return Ni.current=ji,e===null?ji:e}function Zl(){(xe===0||xe===3||xe===2)&&(xe=4),ye===null||!(Ft&268435455)&&!(Qi&268435455)||tt(ye,Ce)}function Ri(e,n){var t=Q;Q|=2;var r=Dp();(ye!==e||Ce!==n)&&(Dn=null,Rt(e,n));do try{r1();break}catch(s){Bp(e,s)}while(!0);if(Rl(),Q=t,Ni.current=r,me!==null)throw Error(L(261));return ye=null,Ce=0,xe}function r1(){for(;me!==null;)Fp(me)}function s1(){for(;me!==null&&!Lm();)Fp(me)}function Fp(e){var n=Hp(e.alternate,e,Ze);e.memoizedProps=e.pendingProps,n===null?Ip(e):me=n,Kl.current=null}function Ip(e){var n=e;do{var t=n.alternate;if(e=n.return,n.flags&32768){if(t=XA(t,n),t!==null){t.flags&=32767,me=t;return}if(e!==null)e.flags|=32768,e.subtreeFlags=0,e.deletions=null;else{xe=6,me=null;return}}else if(t=YA(t,n,Ze),t!==null){me=t;return}if(n=n.sibling,n!==null){me=n;return}me=n=e}while(n!==null);xe===0&&(xe=5)}function St(e,n,t){var r=X,s=ln.transition;try{ln.transition=null,X=1,i1(e,n,t,r)}finally{ln.transition=s,X=r}return null}function i1(e,n,t,r){do dr();while(st!==null);if(Q&6)throw Error(L(327));t=e.finishedWork;var s=e.finishedLanes;if(t===null)return null;if(e.finishedWork=null,e.finishedLanes=0,t===e.current)throw Error(L(177));e.callbackNode=null,e.callbackPriority=0;var i=t.lanes|t.childLanes;if(Hm(e,i),e===ye&&(me=ye=null,Ce=0),!(t.subtreeFlags&2064)&&!(t.flags&2064)||Us||(Us=!0,zp(fi,function(){return dr(),null})),i=(t.flags&15990)!==0,t.subtreeFlags&15990||i){i=ln.transition,ln.transition=null;var o=X;X=1;var l=Q;Q|=4,Kl.current=null,$A(e,t),Rp(t,e),SA(xa),hi=!!va,xa=va=null,e.current=t,e1(t),Tm(),Q=l,X=o,ln.transition=i}else e.current=t;if(Us&&(Us=!1,st=e,Ti=s),i=e.pendingLanes,i===0&&(ut=null),Mm(t.stateNode),Ge(e,he()),n!==null)for(r=e.onRecoverableError,t=0;t<n.length;t++)s=n[t],r(s.value,{componentStack:s.stack,digest:s.digest});if(Li)throw Li=!1,e=Ha,Ha=null,e;return Ti&1&&e.tag!==0&&dr(),i=e.pendingLanes,i&1?e===za?Yr++:(Yr=0,za=e):Yr=0,kt(),null}function dr(){if(st!==null){var e=gf(Ti),n=ln.transition,t=X;try{if(ln.transition=null,X=16>e?16:e,st===null)var r=!1;else{if(e=st,st=null,Ti=0,Q&6)throw Error(L(331));var s=Q;for(Q|=4,H=e.current;H!==null;){var i=H,o=i.child;if(H.flags&16){var l=i.deletions;if(l!==null){for(var c=0;c<l.length;c++){var d=l[c];for(H=d;H!==null;){var u=H;switch(u.tag){case 0:case 11:case 15:Qr(8,u,i)}var f=u.child;if(f!==null)f.return=u,H=f;else for(;H!==null;){u=H;var p=u.sibling,A=u.return;if(Np(u),u===d){H=null;break}if(p!==null){p.return=A,H=p;break}H=A}}}var v=i.alternate;if(v!==null){var x=v.child;if(x!==null){v.child=null;do{var w=x.sibling;x.sibling=null,x=w}while(x!==null)}}H=i}}if(i.subtreeFlags&2064&&o!==null)o.return=i,H=o;else e:for(;H!==null;){if(i=H,i.flags&2048)switch(i.tag){case 0:case 11:case 15:Qr(9,i,i.return)}var g=i.sibling;if(g!==null){g.return=i.return,H=g;break e}H=i.return}}var m=e.current;for(H=m;H!==null;){o=H;var k=o.child;if(o.subtreeFlags&2064&&k!==null)k.return=o,H=k;else e:for(o=m;H!==null;){if(l=H,l.flags&2048)try{switch(l.tag){case 0:case 11:case 15:qi(9,l)}}catch(y){pe(l,l.return,y)}if(l===o){H=null;break e}var b=l.sibling;if(b!==null){b.return=l.return,H=b;break e}H=l.return}}if(Q=s,kt(),Pn&&typeof Pn.onPostCommitFiberRoot=="function")try{Pn.onPostCommitFiberRoot(Hi,e)}catch{}r=!0}return r}finally{X=t,ln.transition=n}}return!1}function Nd(e,n,t){n=gr(t,n),n=gp(e,n,1),e=dt(e,n,1),n=Ie(),e!==null&&(xs(e,1,n),Ge(e,n))}function pe(e,n,t){if(e.tag===3)Nd(e,e,t);else for(;n!==null;){if(n.tag===3){Nd(n,e,t);break}else if(n.tag===1){var r=n.stateNode;if(typeof n.type.getDerivedStateFromError=="function"||typeof r.componentDidCatch=="function"&&(ut===null||!ut.has(r))){e=gr(t,e),e=vp(n,e,1),n=dt(n,e,1),e=Ie(),n!==null&&(xs(n,1,e),Ge(n,e));break}}n=n.return}}function o1(e,n,t){var r=e.pingCache;r!==null&&r.delete(n),n=Ie(),e.pingedLanes|=e.suspendedLanes&t,ye===e&&(Ce&t)===t&&(xe===4||xe===3&&(Ce&130023424)===Ce&&500>he()-Gl?Rt(e,0):_l|=t),Ge(e,n)}function Op(e,n){n===0&&(e.mode&1?(n=Rs,Rs<<=1,!(Rs&130023424)&&(Rs=4194304)):n=1);var t=Ie();e=Kn(e,n),e!==null&&(xs(e,n,t),Ge(e,t))}function a1(e){var n=e.memoizedState,t=0;n!==null&&(t=n.retryLane),Op(e,t)}function l1(e,n){var t=0;switch(e.tag){case 13:var r=e.stateNode,s=e.memoizedState;s!==null&&(t=s.retryLane);break;case 19:r=e.stateNode;break;default:throw Error(L(314))}r!==null&&r.delete(n),Op(e,t)}var Hp;Hp=function(e,n,t){if(e!==null)if(e.memoizedProps!==n.pendingProps||Ke.current)Ve=!0;else{if(!(e.lanes&t)&&!(n.flags&128))return Ve=!1,ZA(e,n,t);Ve=!!(e.flags&131072)}else Ve=!1,oe&&n.flags&1048576&&Vf(n,wi,n.index);switch(n.lanes=0,n.tag){case 2:var r=n.type;ri(e,n),e=n.pendingProps;var s=pr(n,Pe.current);cr(n,t),s=Hl(null,n,r,e,s,t);var i=zl();return n.flags|=1,typeof s=="object"&&s!==null&&typeof s.render=="function"&&s.$$typeof===void 0?(n.tag=1,n.memoizedState=null,n.updateQueue=null,_e(r)?(i=!0,xi(n)):i=!1,n.memoizedState=s.state!==null&&s.state!==void 0?s.state:null,Bl(n),s.updater=Gi,n.stateNode=s,s._reactInternals=n,Na(n,r,e,t),n=Ra(null,n,r,!0,i,t)):(n.tag=0,oe&&i&&jl(n),De(null,n,s,t),n=n.child),n;case 16:r=n.elementType;e:{switch(ri(e,n),e=n.pendingProps,s=r._init,r=s(r._payload),n.type=r,s=n.tag=d1(r),e=An(r,e),s){case 0:n=Ta(null,n,r,e,t);break e;case 1:n=vd(null,n,r,e,t);break e;case 11:n=Ad(null,n,r,e,t);break e;case 14:n=gd(null,n,r,An(r.type,e),t);break e}throw Error(L(306,r,""))}return n;case 0:return r=n.type,s=n.pendingProps,s=n.elementType===r?s:An(r,s),Ta(e,n,r,s,t);case 1:return r=n.type,s=n.pendingProps,s=n.elementType===r?s:An(r,s),vd(e,n,r,s,t);case 3:e:{if(yp(n),e===null)throw Error(L(387));r=n.pendingProps,i=n.memoizedState,s=i.element,Zf(e,n),Ci(n,r,null,t);var o=n.memoizedState;if(r=o.element,i.isDehydrated)if(i={element:r,isDehydrated:!1,cache:o.cache,pendingSuspenseBoundaries:o.pendingSuspenseBoundaries,transitions:o.transitions},n.updateQueue.baseState=i,n.memoizedState=i,n.flags&256){s=gr(Error(L(423)),n),n=xd(e,n,r,t,s);break e}else if(r!==s){s=gr(Error(L(424)),n),n=xd(e,n,r,t,s);break e}else for(Ye=ct(n.stateNode.containerInfo.firstChild),Xe=n,oe=!0,vn=null,t=qf(n,null,r,t),n.child=t;t;)t.flags=t.flags&-3|4096,t=t.sibling;else{if(hr(),r===s){n=_n(e,n,t);break e}De(e,n,r,t)}n=n.child}return n;case 5:return Yf(n),e===null&&Sa(n),r=n.type,s=n.pendingProps,i=e!==null?e.memoizedProps:null,o=s.children,ka(r,s)?o=null:i!==null&&ka(r,i)&&(n.flags|=32),wp(e,n),De(e,n,o,t),n.child;case 6:return e===null&&Sa(n),null;case 13:return bp(e,n,t);case 4:return Dl(n,n.stateNode.containerInfo),r=n.pendingProps,e===null?n.child=mr(n,null,r,t):De(e,n,r,t),n.child;case 11:return r=n.type,s=n.pendingProps,s=n.elementType===r?s:An(r,s),Ad(e,n,r,s,t);case 7:return De(e,n,n.pendingProps,t),n.child;case 8:return De(e,n,n.pendingProps.children,t),n.child;case 12:return De(e,n,n.pendingProps.children,t),n.child;case 10:e:{if(r=n.type._context,s=n.pendingProps,i=n.memoizedProps,o=s.value,ee(yi,r._currentValue),r._currentValue=o,i!==null)if(bn(i.value,o)){if(i.children===s.children&&!Ke.current){n=_n(e,n,t);break e}}else for(i=n.child,i!==null&&(i.return=n);i!==null;){var l=i.dependencies;if(l!==null){o=i.child;for(var c=l.firstContext;c!==null;){if(c.context===r){if(i.tag===1){c=zn(-1,t&-t),c.tag=2;var d=i.updateQueue;if(d!==null){d=d.shared;var u=d.pending;u===null?c.next=c:(c.next=u.next,u.next=c),d.pending=c}}i.lanes|=t,c=i.alternate,c!==null&&(c.lanes|=t),Ea(i.return,t,n),l.lanes|=t;break}c=c.next}}else if(i.tag===10)o=i.type===n.type?null:i.child;else if(i.tag===18){if(o=i.return,o===null)throw Error(L(341));o.lanes|=t,l=o.alternate,l!==null&&(l.lanes|=t),Ea(o,t,n),o=i.sibling}else o=i.child;if(o!==null)o.return=i;else for(o=i;o!==null;){if(o===n){o=null;break}if(i=o.sibling,i!==null){i.return=o.return,o=i;break}o=o.return}i=o}De(e,n,s.children,t),n=n.child}return n;case 9:return s=n.type,r=n.pendingProps.children,cr(n,t),s=dn(s),r=r(s),n.flags|=1,De(e,n,r,t),n.child;case 14:return r=n.type,s=An(r,n.pendingProps),s=An(r.type,s),gd(e,n,r,s,t);case 15:return xp(e,n,n.type,n.pendingProps,t);case 17:return r=n.type,s=n.pendingProps,s=n.elementType===r?s:An(r,s),ri(e,n),n.tag=1,_e(r)?(e=!0,xi(n)):e=!1,cr(n,t),Ap(n,r,s),Na(n,r,s,t),Ra(null,n,r,!0,e,t);case 19:return Cp(e,n,t);case 22:return kp(e,n,t)}throw Error(L(156,n.tag))};function zp(e,n){return pf(e,n)}function c1(e,n,t,r){this.tag=e,this.key=t,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=n,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=r,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function an(e,n,t,r){return new c1(e,n,t,r)}function Yl(e){return e=e.prototype,!(!e||!e.isReactComponent)}function d1(e){if(typeof e=="function")return Yl(e)?1:0;if(e!=null){if(e=e.$$typeof,e===ml)return 11;if(e===Al)return 14}return 2}function pt(e,n){var t=e.alternate;return t===null?(t=an(e.tag,n,e.key,e.mode),t.elementType=e.elementType,t.type=e.type,t.stateNode=e.stateNode,t.alternate=e,e.alternate=t):(t.pendingProps=n,t.type=e.type,t.flags=0,t.subtreeFlags=0,t.deletions=null),t.flags=e.flags&14680064,t.childLanes=e.childLanes,t.lanes=e.lanes,t.child=e.child,t.memoizedProps=e.memoizedProps,t.memoizedState=e.memoizedState,t.updateQueue=e.updateQueue,n=e.dependencies,t.dependencies=n===null?null:{lanes:n.lanes,firstContext:n.firstContext},t.sibling=e.sibling,t.index=e.index,t.ref=e.ref,t}function oi(e,n,t,r,s,i){var o=2;if(r=e,typeof e=="function")Yl(e)&&(o=1);else if(typeof e=="string")o=5;else e:switch(e){case Qt:return Pt(t.children,s,i,n);case hl:o=8,s|=8;break;case Jo:return e=an(12,t,n,s|2),e.elementType=Jo,e.lanes=i,e;case $o:return e=an(13,t,n,s),e.elementType=$o,e.lanes=i,e;case ea:return e=an(19,t,n,s),e.elementType=ea,e.lanes=i,e;case Zu:return Zi(t,s,i,n);default:if(typeof e=="object"&&e!==null)switch(e.$$typeof){case qu:o=10;break e;case Qu:o=9;break e;case ml:o=11;break e;case Al:o=14;break e;case Jn:o=16,r=null;break e}throw Error(L(130,e==null?e:typeof e,""))}return n=an(o,t,n,s),n.elementType=e,n.type=r,n.lanes=i,n}function Pt(e,n,t,r){return e=an(7,e,r,n),e.lanes=t,e}function Zi(e,n,t,r){return e=an(22,e,r,n),e.elementType=Zu,e.lanes=t,e.stateNode={isHidden:!1},e}function Po(e,n,t){return e=an(6,e,null,n),e.lanes=t,e}function Mo(e,n,t){return n=an(4,e.children!==null?e.children:[],e.key,n),n.lanes=t,n.stateNode={containerInfo:e.containerInfo,pendingChildren:null,implementation:e.implementation},n}function u1(e,n,t,r,s){this.tag=n,this.containerInfo=e,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=po(0),this.expirationTimes=po(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=po(0),this.identifierPrefix=r,this.onRecoverableError=s,this.mutableSourceEagerHydrationData=null}function Xl(e,n,t,r,s,i,o,l,c){return e=new u1(e,n,t,l,c),n===1?(n=1,i===!0&&(n|=8)):n=0,i=an(3,null,null,n),e.current=i,i.stateNode=e,i.memoizedState={element:r,isDehydrated:t,cache:null,transitions:null,pendingSuspenseBoundaries:null},Bl(i),e}function f1(e,n,t){var r=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:qt,key:r==null?null:""+r,children:e,containerInfo:n,implementation:t}}function Up(e){if(!e)return gt;e=e._reactInternals;e:{if(Ut(e)!==e||e.tag!==1)throw Error(L(170));var n=e;do{switch(n.tag){case 3:n=n.stateNode.context;break e;case 1:if(_e(n.type)){n=n.stateNode.__reactInternalMemoizedMergedChildContext;break e}}n=n.return}while(n!==null);throw Error(L(171))}if(e.tag===1){var t=e.type;if(_e(t))return Uf(e,t,n)}return n}function Wp(e,n,t,r,s,i,o,l,c){return e=Xl(t,r,!0,e,s,i,o,l,c),e.context=Up(null),t=e.current,r=Ie(),s=ft(t),i=zn(r,s),i.callback=n??null,dt(t,i,s),e.current.lanes=s,xs(e,s,r),Ge(e,r),e}function Yi(e,n,t,r){var s=n.current,i=Ie(),o=ft(s);return t=Up(t),n.context===null?n.context=t:n.pendingContext=t,n=zn(i,o),n.payload={element:e},r=r===void 0?null:r,r!==null&&(n.callback=r),e=dt(s,n,o),e!==null&&(yn(e,s,o,i),ei(e,s,o)),o}function Pi(e){if(e=e.current,!e.child)return null;switch(e.child.tag){case 5:return e.child.stateNode;default:return e.child.stateNode}}function Ld(e,n){if(e=e.memoizedState,e!==null&&e.dehydrated!==null){var t=e.retryLane;e.retryLane=t!==0&&t<n?t:n}}function Jl(e,n){Ld(e,n),(e=e.alternate)&&Ld(e,n)}function p1(){return null}var Vp=typeof reportError=="function"?reportError:function(e){console.error(e)};function $l(e){this._internalRoot=e}Xi.prototype.render=$l.prototype.render=function(e){var n=this._internalRoot;if(n===null)throw Error(L(409));Yi(e,n,null,null)};Xi.prototype.unmount=$l.prototype.unmount=function(){var e=this._internalRoot;if(e!==null){this._internalRoot=null;var n=e.containerInfo;It(function(){Yi(null,e,null,null)}),n[Vn]=null}};function Xi(e){this._internalRoot=e}Xi.prototype.unstable_scheduleHydration=function(e){if(e){var n=kf();e={blockedOn:null,target:e,priority:n};for(var t=0;t<nt.length&&n!==0&&n<nt[t].priority;t++);nt.splice(t,0,e),t===0&&yf(e)}};function ec(e){return!(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11)}function Ji(e){return!(!e||e.nodeType!==1&&e.nodeType!==9&&e.nodeType!==11&&(e.nodeType!==8||e.nodeValue!==" react-mount-point-unstable "))}function Td(){}function h1(e,n,t,r,s){if(s){if(typeof r=="function"){var i=r;r=function(){var d=Pi(o);i.call(d)}}var o=Wp(n,r,e,0,null,!1,!1,"",Td);return e._reactRootContainer=o,e[Vn]=o.current,os(e.nodeType===8?e.parentNode:e),It(),o}for(;s=e.lastChild;)e.removeChild(s);if(typeof r=="function"){var l=r;r=function(){var d=Pi(c);l.call(d)}}var c=Xl(e,0,!1,null,null,!1,!1,"",Td);return e._reactRootContainer=c,e[Vn]=c.current,os(e.nodeType===8?e.parentNode:e),It(function(){Yi(n,c,t,r)}),c}function $i(e,n,t,r,s){var i=t._reactRootContainer;if(i){var o=i;if(typeof s=="function"){var l=s;s=function(){var c=Pi(o);l.call(c)}}Yi(n,o,e,s)}else o=h1(t,n,e,s,r);return Pi(o)}vf=function(e){switch(e.tag){case 3:var n=e.stateNode;if(n.current.memoizedState.isDehydrated){var t=Or(n.pendingLanes);t!==0&&(xl(n,t|1),Ge(n,he()),!(Q&6)&&(vr=he()+500,kt()))}break;case 13:It(function(){var r=Kn(e,1);if(r!==null){var s=Ie();yn(r,e,1,s)}}),Jl(e,1)}};kl=function(e){if(e.tag===13){var n=Kn(e,134217728);if(n!==null){var t=Ie();yn(n,e,134217728,t)}Jl(e,134217728)}};xf=function(e){if(e.tag===13){var n=ft(e),t=Kn(e,n);if(t!==null){var r=Ie();yn(t,e,n,r)}Jl(e,n)}};kf=function(){return X};wf=function(e,n){var t=X;try{return X=e,n()}finally{X=t}};da=function(e,n,t){switch(n){case"input":if(ra(e,t),n=t.name,t.type==="radio"&&n!=null){for(t=e;t.parentNode;)t=t.parentNode;for(t=t.querySelectorAll("input[name="+JSON.stringify(""+n)+'][type="radio"]'),n=0;n<t.length;n++){var r=t[n];if(r!==e&&r.form===e.form){var s=Vi(r);if(!s)throw Error(L(90));Xu(r),ra(r,s)}}}break;case"textarea":$u(e,t);break;case"select":n=t.value,n!=null&&ir(e,!!t.multiple,n,!1)}};af=ql;lf=It;var m1={usingClientEntryPoint:!1,Events:[ws,Jt,Vi,sf,of,ql]},Dr={findFiberByHostInstance:jt,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},A1={bundleType:Dr.bundleType,version:Dr.version,rendererPackageName:Dr.rendererPackageName,rendererConfig:Dr.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:qn.ReactCurrentDispatcher,findHostInstanceByFiber:function(e){return e=uf(e),e===null?null:e.stateNode},findFiberByHostInstance:Dr.findFiberByHostInstance||p1,findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"){var Ws=__REACT_DEVTOOLS_GLOBAL_HOOK__;if(!Ws.isDisabled&&Ws.supportsFiber)try{Hi=Ws.inject(A1),Pn=Ws}catch{}}$e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=m1;$e.createPortal=function(e,n){var t=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!ec(n))throw Error(L(200));return f1(e,n,null,t)};$e.createRoot=function(e,n){if(!ec(e))throw Error(L(299));var t=!1,r="",s=Vp;return n!=null&&(n.unstable_strictMode===!0&&(t=!0),n.identifierPrefix!==void 0&&(r=n.identifierPrefix),n.onRecoverableError!==void 0&&(s=n.onRecoverableError)),n=Xl(e,1,!1,null,null,t,!1,r,s),e[Vn]=n.current,os(e.nodeType===8?e.parentNode:e),new $l(n)};$e.findDOMNode=function(e){if(e==null)return null;if(e.nodeType===1)return e;var n=e._reactInternals;if(n===void 0)throw typeof e.render=="function"?Error(L(188)):(e=Object.keys(e).join(","),Error(L(268,e)));return e=uf(n),e=e===null?null:e.stateNode,e};$e.flushSync=function(e){return It(e)};$e.hydrate=function(e,n,t){if(!Ji(n))throw Error(L(200));return $i(null,e,n,!0,t)};$e.hydrateRoot=function(e,n,t){if(!ec(e))throw Error(L(405));var r=t!=null&&t.hydratedSources||null,s=!1,i="",o=Vp;if(t!=null&&(t.unstable_strictMode===!0&&(s=!0),t.identifierPrefix!==void 0&&(i=t.identifierPrefix),t.onRecoverableError!==void 0&&(o=t.onRecoverableError)),n=Wp(n,null,e,1,t??null,s,!1,i,o),e[Vn]=n.current,os(e),r)for(e=0;e<r.length;e++)t=r[e],s=t._getVersion,s=s(t._source),n.mutableSourceEagerHydrationData==null?n.mutableSourceEagerHydrationData=[t,s]:n.mutableSourceEagerHydrationData.push(t,s);return new Xi(n)};$e.render=function(e,n,t){if(!Ji(n))throw Error(L(200));return $i(null,e,n,!1,t)};$e.unmountComponentAtNode=function(e){if(!Ji(e))throw Error(L(40));return e._reactRootContainer?(It(function(){$i(null,null,e,!1,function(){e._reactRootContainer=null,e[Vn]=null})}),!0):!1};$e.unstable_batchedUpdates=ql;$e.unstable_renderSubtreeIntoContainer=function(e,n,t,r){if(!Ji(t))throw Error(L(200));if(e==null||e._reactInternals===void 0)throw Error(L(38));return $i(e,n,t,!1,r)};$e.version="18.3.1-next-f1338f8080-20240426";function Kp(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Kp)}catch(e){console.error(e)}}Kp(),Vu.exports=$e;var g1=Vu.exports,_p,Rd=g1;_p=Rd.createRoot,Rd.hydrateRoot;/**
 * @remix-run/router v1.23.4
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */function ms(){return ms=Object.assign?Object.assign.bind():function(e){for(var n=1;n<arguments.length;n++){var t=arguments[n];for(var r in t)({}).hasOwnProperty.call(t,r)&&(e[r]=t[r])}return e},ms.apply(null,arguments)}var it;(function(e){e.Pop="POP",e.Push="PUSH",e.Replace="REPLACE"})(it||(it={}));const Pd="popstate";function v1(e){e===void 0&&(e={});function n(r,s){let{pathname:i,search:o,hash:l}=r.location;return Va("",{pathname:i,search:o,hash:l},s.state&&s.state.usr||null,s.state&&s.state.key||"default")}function t(r,s){return typeof s=="string"?s:Mi(s)}return k1(n,t,null,e)}function Ae(e,n){if(e===!1||e===null||typeof e>"u")throw new Error(n)}function Gp(e,n){if(!e){typeof console<"u"&&console.warn(n);try{throw new Error(n)}catch{}}}function x1(){return Math.random().toString(36).substr(2,8)}function Md(e,n){return{usr:e.state,key:e.key,idx:n}}function Va(e,n,t,r){return t===void 0&&(t=null),ms({pathname:typeof e=="string"?e:e.pathname,search:"",hash:""},typeof n=="string"?br(n):n,{state:t,key:n&&n.key||r||x1()})}function Mi(e){let{pathname:n="/",search:t="",hash:r=""}=e;return t&&t!=="?"&&(n+=t.charAt(0)==="?"?t:"?"+t),r&&r!=="#"&&(n+=r.charAt(0)==="#"?r:"#"+r),n}function br(e){let n={};if(e){let t=e.indexOf("#");t>=0&&(n.hash=e.substr(t),e=e.substr(0,t));let r=e.indexOf("?");r>=0&&(n.search=e.substr(r),e=e.substr(0,r)),e&&(n.pathname=e)}return n}function k1(e,n,t,r){r===void 0&&(r={});let{window:s=document.defaultView,v5Compat:i=!1}=r,o=s.history,l=it.Pop,c=null,d=u();d==null&&(d=0,o.replaceState(ms({},o.state,{idx:d}),""));function u(){return(o.state||{idx:null}).idx}function f(){l=it.Pop;let w=u(),g=w==null?null:w-d;d=w,c&&c({action:l,location:x.location,delta:g})}function p(w,g){l=it.Push;let m=Va(x.location,w,g);d=u()+1;let k=Md(m,d),b=x.createHref(m);try{o.pushState(k,"",b)}catch(y){if(y instanceof DOMException&&y.name==="DataCloneError")throw y;s.location.assign(b)}i&&c&&c({action:l,location:x.location,delta:1})}function A(w,g){l=it.Replace;let m=Va(x.location,w,g);d=u();let k=Md(m,d),b=x.createHref(m);o.replaceState(k,"",b),i&&c&&c({action:l,location:x.location,delta:0})}function v(w){let g=s.location.origin!=="null"?s.location.origin:s.location.href,m=typeof w=="string"?w:Mi(w);return m=m.replace(/ $/,"%20"),Ae(g,"No window.location.(origin|href) available to create URL for href: "+m),new URL(m,g)}let x={get action(){return l},get location(){return e(s,o)},listen(w){if(c)throw new Error("A history only accepts one active listener");return s.addEventListener(Pd,f),c=w,()=>{s.removeEventListener(Pd,f),c=null}},createHref(w){return n(s,w)},createURL:v,encodeLocation(w){let g=v(w);return{pathname:g.pathname,search:g.search,hash:g.hash}},push:p,replace:A,go(w){return o.go(w)}};return x}var Bd;(function(e){e.data="data",e.deferred="deferred",e.redirect="redirect",e.error="error"})(Bd||(Bd={}));function w1(e,n,t){return t===void 0&&(t="/"),y1(e,n,t)}function y1(e,n,t,r){let s=typeof n=="string"?br(n):n,i=nc(s.pathname||"/",t);if(i==null)return null;let o=qp(e);b1(o);let l=null,c=D1(i);for(let d=0;l==null&&d<o.length;++d)l=P1(o[d],c);return l}function qp(e,n,t,r){n===void 0&&(n=[]),t===void 0&&(t=[]),r===void 0&&(r="");let s=(i,o,l)=>{let c={relativePath:l===void 0?i.path||"":l,caseSensitive:i.caseSensitive===!0,childrenIndex:o,route:i};c.relativePath.startsWith("/")&&(Ae(c.relativePath.startsWith(r),'Absolute route path "'+c.relativePath+'" nested under path '+('"'+r+'" is not valid. An absolute child route path ')+"must start with the combined path of all its parent routes."),c.relativePath=c.relativePath.slice(r.length));let d=ht([r,c.relativePath]),u=t.concat(c);i.children&&i.children.length>0&&(Ae(i.index!==!0,"Index routes must not have child routes. Please remove "+('all child routes from route path "'+d+'".')),qp(i.children,n,u,d)),!(i.path==null&&!i.index)&&n.push({path:d,score:T1(d,i.index),routesMeta:u})};return e.forEach((i,o)=>{var l;if(i.path===""||!((l=i.path)!=null&&l.includes("?")))s(i,o);else for(let c of Qp(i.path))s(i,o,c)}),n}function Qp(e){let n=e.split("/");if(n.length===0)return[];let[t,...r]=n,s=t.endsWith("?"),i=t.replace(/\?$/,"");if(r.length===0)return s?[i,""]:[i];let o=Qp(r.join("/")),l=[];return l.push(...o.map(c=>c===""?i:[i,c].join("/"))),s&&l.push(...o),l.map(c=>e.startsWith("/")&&c===""?"/":c)}function b1(e){e.sort((n,t)=>n.score!==t.score?t.score-n.score:R1(n.routesMeta.map(r=>r.childrenIndex),t.routesMeta.map(r=>r.childrenIndex)))}const C1=/^:[\w-]+$/,S1=3,E1=2,j1=1,N1=10,L1=-2,Dd=e=>e==="*";function T1(e,n){let t=e.split("/"),r=t.length;return t.some(Dd)&&(r+=L1),n&&(r+=E1),t.filter(s=>!Dd(s)).reduce((s,i)=>s+(C1.test(i)?S1:i===""?j1:N1),r)}function R1(e,n){return e.length===n.length&&e.slice(0,-1).every((r,s)=>r===n[s])?e[e.length-1]-n[n.length-1]:0}function P1(e,n,t){let{routesMeta:r}=e,s={},i="/",o=[];for(let l=0;l<r.length;++l){let c=r[l],d=l===r.length-1,u=i==="/"?n:n.slice(i.length)||"/",f=M1({path:c.relativePath,caseSensitive:c.caseSensitive,end:d},u),p=c.route;if(!f)return null;Object.assign(s,f.params),o.push({params:s,pathname:ht([i,f.pathname]),pathnameBase:O1(ht([i,f.pathnameBase])),route:p}),f.pathnameBase!=="/"&&(i=ht([i,f.pathnameBase]))}return o}function M1(e,n){typeof e=="string"&&(e={path:e,caseSensitive:!1,end:!0});let[t,r]=B1(e.path,e.caseSensitive,e.end),s=n.match(t);if(!s)return null;let i=s[0],o=i.replace(/(.)\/+$/,"$1"),l=s.slice(1);return{params:r.reduce((d,u,f)=>{let{paramName:p,isOptional:A}=u;if(p==="*"){let x=l[f]||"";o=i.slice(0,i.length-x.length).replace(/(.)\/+$/,"$1")}const v=l[f];return A&&!v?d[p]=void 0:d[p]=(v||"").replace(/%2F/g,"/"),d},{}),pathname:i,pathnameBase:o,pattern:e}}function B1(e,n,t){n===void 0&&(n=!1),t===void 0&&(t=!0),Gp(e==="*"||!e.endsWith("*")||e.endsWith("/*"),'Route path "'+e+'" will be treated as if it were '+('"'+e.replace(/\*$/,"/*")+'" because the `*` character must ')+"always follow a `/` in the pattern. To get rid of this warning, "+('please change the route path to "'+e.replace(/\*$/,"/*")+'".'));let r=[],s="^"+e.replace(/\/*\*?$/,"").replace(/^\/*/,"/").replace(/[\\.*+^${}|()[\]]/g,"\\$&").replace(/\/:([\w-]+)(\?)?/g,(o,l,c)=>(r.push({paramName:l,isOptional:c!=null}),c?"/?([^\\/]+)?":"/([^\\/]+)"));return e.endsWith("*")?(r.push({paramName:"*"}),s+=e==="*"||e==="/*"?"(.*)$":"(?:\\/(.+)|\\/*)$"):t?s+="\\/*$":e!==""&&e!=="/"&&(s+="(?:(?=\\/|$))"),[new RegExp(s,n?void 0:"i"),r]}function D1(e){try{return e.split("/").map(n=>decodeURIComponent(n).replace(/\//g,"%2F")).join("/")}catch(n){return Gp(!1,'The URL path "'+e+'" could not be decoded because it is is a malformed URL segment. This is probably due to a bad percent '+("encoding ("+n+").")),e}}function nc(e,n){if(n==="/")return e;if(!e.toLowerCase().startsWith(n.toLowerCase()))return null;let t=n.endsWith("/")?n.length-1:n.length,r=e.charAt(t);return r&&r!=="/"?null:e.slice(t)||"/"}function F1(e,n){n===void 0&&(n="/");let{pathname:t,search:r="",hash:s=""}=typeof e=="string"?br(e):e,i;return t?(t=Xp(t),t.startsWith("/")?i=Fd(t.substring(1),"/"):i=Fd(t,n)):i=n,{pathname:i,search:H1(r),hash:z1(s)}}function Fd(e,n){let t=n.replace(/\/+$/,"").split("/");return e.split("/").forEach(s=>{s===".."?t.length>1&&t.pop():s!=="."&&t.push(s)}),t.length>1?t.join("/"):"/"}function Bo(e,n,t,r){return"Cannot include a '"+e+"' character in a manually specified "+("`to."+n+"` field ["+JSON.stringify(r)+"].  Please separate it out to the ")+("`to."+t+"` field. Alternatively you may provide the full path as ")+'a string in <Link to="..."> and the router will parse it for you.'}function I1(e){return e.filter((n,t)=>t===0||n.route.path&&n.route.path.length>0)}function Zp(e,n){let t=I1(e);return n?t.map((r,s)=>s===t.length-1?r.pathname:r.pathnameBase):t.map(r=>r.pathnameBase)}function Yp(e,n,t,r){r===void 0&&(r=!1);let s;typeof e=="string"?s=br(e):(s=ms({},e),Ae(!s.pathname||!s.pathname.includes("?"),Bo("?","pathname","search",s)),Ae(!s.pathname||!s.pathname.includes("#"),Bo("#","pathname","hash",s)),Ae(!s.search||!s.search.includes("#"),Bo("#","search","hash",s)));let i=e===""||s.pathname==="",o=i?"/":s.pathname,l;if(o==null)l=t;else{let f=n.length-1;if(!r&&o.startsWith("..")){let p=o.split("/");for(;p[0]==="..";)p.shift(),f-=1;s.pathname=p.join("/")}l=f>=0?n[f]:"/"}let c=F1(s,l),d=o&&o!=="/"&&o.endsWith("/"),u=(i||o===".")&&t.endsWith("/");return!c.pathname.endsWith("/")&&(d||u)&&(c.pathname+="/"),c}const Xp=e=>e.replace(/\/\/+/g,"/"),ht=e=>Xp(e.join("/")),O1=e=>e.replace(/\/+$/,"").replace(/^\/*/,"/"),H1=e=>!e||e==="?"?"":e.startsWith("?")?e:"?"+e,z1=e=>!e||e==="#"?"":e.startsWith("#")?e:"#"+e;function U1(e){return e!=null&&typeof e.status=="number"&&typeof e.statusText=="string"&&typeof e.internal=="boolean"&&"data"in e}const Jp=["post","put","patch","delete"];new Set(Jp);const W1=["get",...Jp];new Set(W1);/**
 * React Router v6.30.6
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */function As(){return As=Object.assign?Object.assign.bind():function(e){for(var n=1;n<arguments.length;n++){var t=arguments[n];for(var r in t)({}).hasOwnProperty.call(t,r)&&(e[r]=t[r])}return e},As.apply(null,arguments)}const tc=h.createContext(null),V1=h.createContext(null),Wt=h.createContext(null),eo=h.createContext(null),wt=h.createContext({outlet:null,matches:[],isDataRoute:!1}),$p=h.createContext(null);function K1(e,n){let{relative:t}=n===void 0?{}:n;bs()||Ae(!1);let{basename:r,navigator:s}=h.useContext(Wt),{hash:i,pathname:o,search:l}=nh(e,{relative:t}),c=o;return r!=="/"&&(c=o==="/"?r:ht([r,o])),s.createHref({pathname:c,search:l,hash:i})}function bs(){return h.useContext(eo)!=null}function Vt(){return bs()||Ae(!1),h.useContext(eo).location}function eh(e){h.useContext(Wt).static||h.useLayoutEffect(e)}function Qn(){let{isDataRoute:e}=h.useContext(wt);return e?rg():_1()}function _1(){bs()||Ae(!1);let e=h.useContext(tc),{basename:n,future:t,navigator:r}=h.useContext(Wt),{matches:s}=h.useContext(wt),{pathname:i}=Vt(),o=JSON.stringify(Zp(s,t.v7_relativeSplatPath)),l=h.useRef(!1);return eh(()=>{l.current=!0}),h.useCallback(function(d,u){if(u===void 0&&(u={}),!l.current)return;if(typeof d=="number"){r.go(d);return}let f=Yp(d,JSON.parse(o),i,u.relative==="path");e==null&&n!=="/"&&(f.pathname=f.pathname==="/"?n:ht([n,f.pathname])),(u.replace?r.replace:r.push)(f,u.state,u)},[n,r,o,i,e])}function rc(){let{matches:e}=h.useContext(wt),n=e[e.length-1];return n?n.params:{}}function nh(e,n){let{relative:t}=n===void 0?{}:n,{future:r}=h.useContext(Wt),{matches:s}=h.useContext(wt),{pathname:i}=Vt(),o=JSON.stringify(Zp(s,r.v7_relativeSplatPath));return h.useMemo(()=>Yp(e,JSON.parse(o),i,t==="path"),[e,o,i,t])}function G1(e,n){return q1(e,n)}function q1(e,n,t,r){bs()||Ae(!1);let{navigator:s}=h.useContext(Wt),{matches:i}=h.useContext(wt),o=i[i.length-1],l=o?o.params:{};o&&o.pathname;let c=o?o.pathnameBase:"/";o&&o.route;let d=Vt(),u;if(n){var f;let w=typeof n=="string"?br(n):n;c==="/"||(f=w.pathname)!=null&&f.startsWith(c)||Ae(!1),u=w}else u=d;let p=u.pathname||"/",A=p;if(c!=="/"){let w=c.replace(/^\//,"").split("/");A="/"+p.replace(/^\//,"").split("/").slice(w.length).join("/")}let v=w1(e,{pathname:A}),x=J1(v&&v.map(w=>Object.assign({},w,{params:Object.assign({},l,w.params),pathname:ht([c,s.encodeLocation?s.encodeLocation(w.pathname).pathname:w.pathname]),pathnameBase:w.pathnameBase==="/"?c:ht([c,s.encodeLocation?s.encodeLocation(w.pathnameBase).pathname:w.pathnameBase])})),i,t,r);return n&&x?h.createElement(eo.Provider,{value:{location:As({pathname:"/",search:"",hash:"",state:null,key:"default"},u),navigationType:it.Pop}},x):x}function Q1(){let e=tg(),n=U1(e)?e.status+" "+e.statusText:e instanceof Error?e.message:JSON.stringify(e),t=e instanceof Error?e.stack:null,s={padding:"0.5rem",backgroundColor:"rgba(200,200,200, 0.5)"};return h.createElement(h.Fragment,null,h.createElement("h2",null,"Unexpected Application Error!"),h.createElement("h3",{style:{fontStyle:"italic"}},n),t?h.createElement("pre",{style:s},t):null,null)}const Z1=h.createElement(Q1,null);class Y1 extends h.Component{constructor(n){super(n),this.state={location:n.location,revalidation:n.revalidation,error:n.error}}static getDerivedStateFromError(n){return{error:n}}static getDerivedStateFromProps(n,t){return t.location!==n.location||t.revalidation!=="idle"&&n.revalidation==="idle"?{error:n.error,location:n.location,revalidation:n.revalidation}:{error:n.error!==void 0?n.error:t.error,location:t.location,revalidation:n.revalidation||t.revalidation}}componentDidCatch(n,t){console.error("React Router caught the following error during render",n,t)}render(){return this.state.error!==void 0?h.createElement(wt.Provider,{value:this.props.routeContext},h.createElement($p.Provider,{value:this.state.error,children:this.props.component})):this.props.children}}function X1(e){let{routeContext:n,match:t,children:r}=e,s=h.useContext(tc);return s&&s.static&&s.staticContext&&(t.route.errorElement||t.route.ErrorBoundary)&&(s.staticContext._deepestRenderedBoundaryId=t.route.id),h.createElement(wt.Provider,{value:n},r)}function J1(e,n,t,r){var s;if(n===void 0&&(n=[]),t===void 0&&(t=null),r===void 0&&(r=null),e==null){var i;if(!t)return null;if(t.errors)e=t.matches;else if((i=r)!=null&&i.v7_partialHydration&&n.length===0&&!t.initialized&&t.matches.length>0)e=t.matches;else return null}let o=e,l=(s=t)==null?void 0:s.errors;if(l!=null){let u=o.findIndex(f=>f.route.id&&(l==null?void 0:l[f.route.id])!==void 0);u>=0||Ae(!1),o=o.slice(0,Math.min(o.length,u+1))}let c=!1,d=-1;if(t&&r&&r.v7_partialHydration)for(let u=0;u<o.length;u++){let f=o[u];if((f.route.HydrateFallback||f.route.hydrateFallbackElement)&&(d=u),f.route.id){let{loaderData:p,errors:A}=t,v=f.route.loader&&p[f.route.id]===void 0&&(!A||A[f.route.id]===void 0);if(f.route.lazy||v){c=!0,d>=0?o=o.slice(0,d+1):o=[o[0]];break}}}return o.reduceRight((u,f,p)=>{let A,v=!1,x=null,w=null;t&&(A=l&&f.route.id?l[f.route.id]:void 0,x=f.route.errorElement||Z1,c&&(d<0&&p===0?(sg("route-fallback"),v=!0,w=null):d===p&&(v=!0,w=f.route.hydrateFallbackElement||null)));let g=n.concat(o.slice(0,p+1)),m=()=>{let k;return A?k=x:v?k=w:f.route.Component?k=h.createElement(f.route.Component,null):f.route.element?k=f.route.element:k=u,h.createElement(X1,{match:f,routeContext:{outlet:u,matches:g,isDataRoute:t!=null},children:k})};return t&&(f.route.ErrorBoundary||f.route.errorElement||p===0)?h.createElement(Y1,{location:t.location,revalidation:t.revalidation,component:x,error:A,children:m(),routeContext:{outlet:null,matches:g,isDataRoute:!0}}):m()},null)}var th=function(e){return e.UseBlocker="useBlocker",e.UseRevalidator="useRevalidator",e.UseNavigateStable="useNavigate",e}(th||{}),rh=function(e){return e.UseBlocker="useBlocker",e.UseLoaderData="useLoaderData",e.UseActionData="useActionData",e.UseRouteError="useRouteError",e.UseNavigation="useNavigation",e.UseRouteLoaderData="useRouteLoaderData",e.UseMatches="useMatches",e.UseRevalidator="useRevalidator",e.UseNavigateStable="useNavigate",e.UseRouteId="useRouteId",e}(rh||{});function $1(e){let n=h.useContext(tc);return n||Ae(!1),n}function eg(e){let n=h.useContext(V1);return n||Ae(!1),n}function ng(e){let n=h.useContext(wt);return n||Ae(!1),n}function sh(e){let n=ng(),t=n.matches[n.matches.length-1];return t.route.id||Ae(!1),t.route.id}function tg(){var e;let n=h.useContext($p),t=eg(),r=sh();return n!==void 0?n:(e=t.errors)==null?void 0:e[r]}function rg(){let{router:e}=$1(th.UseNavigateStable),n=sh(rh.UseNavigateStable),t=h.useRef(!1);return eh(()=>{t.current=!0}),h.useCallback(function(s,i){i===void 0&&(i={}),t.current&&(typeof s=="number"?e.navigate(s):e.navigate(s,As({fromRouteId:n},i)))},[e,n])}const Id={};function sg(e,n,t){Id[e]||(Id[e]=!0)}function ig(e,n){e==null||e.v7_startTransition,e==null||e.v7_relativeSplatPath}function ai(e){Ae(!1)}function og(e){let{basename:n="/",children:t=null,location:r,navigationType:s=it.Pop,navigator:i,static:o=!1,future:l}=e;bs()&&Ae(!1);let c=n.replace(/^\/*/,"/"),d=h.useMemo(()=>({basename:c,navigator:i,static:o,future:As({v7_relativeSplatPath:!1},l)}),[c,l,i,o]);typeof r=="string"&&(r=br(r));let{pathname:u="/",search:f="",hash:p="",state:A=null,key:v="default"}=r,x=h.useMemo(()=>{let w=nc(u,c);return w==null?null:{location:{pathname:w,search:f,hash:p,state:A,key:v},navigationType:s}},[c,u,f,p,A,v,s]);return x==null?null:h.createElement(Wt.Provider,{value:d},h.createElement(eo.Provider,{children:t,value:x}))}function ag(e){let{children:n,location:t}=e;return G1(Ka(n),t)}new Promise(()=>{});function Ka(e,n){n===void 0&&(n=[]);let t=[];return h.Children.forEach(e,(r,s)=>{if(!h.isValidElement(r))return;let i=[...n,s];if(r.type===h.Fragment){t.push.apply(t,Ka(r.props.children,i));return}r.type!==ai&&Ae(!1),!r.props.index||!r.props.children||Ae(!1);let o={id:r.props.id||i.join("-"),caseSensitive:r.props.caseSensitive,element:r.props.element,Component:r.props.Component,index:r.props.index,path:r.props.path,loader:r.props.loader,action:r.props.action,errorElement:r.props.errorElement,ErrorBoundary:r.props.ErrorBoundary,hasErrorBoundary:r.props.ErrorBoundary!=null||r.props.errorElement!=null,shouldRevalidate:r.props.shouldRevalidate,handle:r.props.handle,lazy:r.props.lazy};r.props.children&&(o.children=Ka(r.props.children,i)),t.push(o)}),t}/**
 * React Router DOM v6.30.6
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */function _a(){return _a=Object.assign?Object.assign.bind():function(e){for(var n=1;n<arguments.length;n++){var t=arguments[n];for(var r in t)({}).hasOwnProperty.call(t,r)&&(e[r]=t[r])}return e},_a.apply(null,arguments)}function lg(e,n){if(e==null)return{};var t={};for(var r in e)if({}.hasOwnProperty.call(e,r)){if(n.indexOf(r)!==-1)continue;t[r]=e[r]}return t}function cg(e){return!!(e.metaKey||e.altKey||e.ctrlKey||e.shiftKey)}function dg(e,n){return e.button===0&&(!n||n==="_self")&&!cg(e)}function Ga(e){return e===void 0&&(e=""),new URLSearchParams(typeof e=="string"||Array.isArray(e)||e instanceof URLSearchParams?e:Object.keys(e).reduce((n,t)=>{let r=e[t];return n.concat(Array.isArray(r)?r.map(s=>[t,s]):[[t,r]])},[]))}function ug(e,n){let t=Ga(e);return n&&n.forEach((r,s)=>{t.has(s)||n.getAll(s).forEach(i=>{t.append(s,i)})}),t}const fg=["onClick","relative","reloadDocument","replace","state","target","to","preventScrollReset","viewTransition"],pg="6";try{window.__reactRouterVersion=pg}catch{}const hg="startTransition",Od=om[hg];function mg(e){let{basename:n,children:t,future:r,window:s}=e,i=h.useRef();i.current==null&&(i.current=v1({window:s,v5Compat:!0}));let o=i.current,[l,c]=h.useState({action:o.action,location:o.location}),{v7_startTransition:d}=r||{},u=h.useCallback(f=>{d&&Od?Od(()=>c(f)):c(f)},[c,d]);return h.useLayoutEffect(()=>o.listen(u),[o,u]),h.useEffect(()=>ig(r),[r]),h.createElement(og,{basename:n,children:t,location:l.location,navigationType:l.action,navigator:o,future:r})}const Ag=typeof window<"u"&&typeof window.document<"u"&&typeof window.document.createElement<"u",gg=/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i,cn=h.forwardRef(function(n,t){let{onClick:r,relative:s,reloadDocument:i,replace:o,state:l,target:c,to:d,preventScrollReset:u,viewTransition:f}=n,p=lg(n,fg),{basename:A}=h.useContext(Wt),v,x=!1;if(typeof d=="string"&&gg.test(d)&&(v=d,Ag))try{let k=new URL(window.location.href),b=d.startsWith("//")?new URL(k.protocol+d):new URL(d),y=nc(b.pathname,A);b.origin===k.origin&&y!=null?d=y+b.search+b.hash:x=!0}catch{}let w=K1(d,{relative:s}),g=vg(d,{replace:o,state:l,target:c,preventScrollReset:u,relative:s,viewTransition:f});function m(k){r&&r(k),k.defaultPrevented||g(k)}return h.createElement("a",_a({},p,{href:v||w,onClick:x||i?r:m,ref:t,target:c}))});var Hd;(function(e){e.UseScrollRestoration="useScrollRestoration",e.UseSubmit="useSubmit",e.UseSubmitFetcher="useSubmitFetcher",e.UseFetcher="useFetcher",e.useViewTransitionState="useViewTransitionState"})(Hd||(Hd={}));var zd;(function(e){e.UseFetcher="useFetcher",e.UseFetchers="useFetchers",e.UseScrollRestoration="useScrollRestoration"})(zd||(zd={}));function vg(e,n){let{target:t,replace:r,state:s,preventScrollReset:i,relative:o,viewTransition:l}=n===void 0?{}:n,c=Qn(),d=Vt(),u=nh(e,{relative:o});return h.useCallback(f=>{if(dg(f,t)){f.preventDefault();let p=r!==void 0?r:Mi(d)===Mi(u);c(e,{replace:p,state:s,preventScrollReset:i,relative:o,viewTransition:l})}},[d,c,u,r,s,t,e,i,o,l])}function xg(e){let n=h.useRef(Ga(e)),t=h.useRef(!1),r=Vt(),s=h.useMemo(()=>ug(r.search,t.current?null:n.current),[r.search]),i=Qn(),o=h.useCallback((l,c)=>{const d=Ga(typeof l=="function"?l(s):l);t.current=!0,i("?"+d,c)},[i,s]);return[s,o]}const Ud=e=>{let n;const t=new Set,r=(d,u)=>{const f=typeof d=="function"?d(n):d;if(!Object.is(f,n)){const p=n;n=u??(typeof f!="object"||f===null)?f:Object.assign({},n,f),t.forEach(A=>A(n,p))}},s=()=>n,l={setState:r,getState:s,getInitialState:()=>c,subscribe:d=>(t.add(d),()=>t.delete(d))},c=n=e(r,s,l);return l},kg=e=>e?Ud(e):Ud,wg=e=>e;function yg(e,n=wg){const t=Gt.useSyncExternalStore(e.subscribe,Gt.useCallback(()=>n(e.getState()),[e,n]),Gt.useCallback(()=>n(e.getInitialState()),[e,n]));return Gt.useDebugValue(t),t}const bg=e=>{const n=kg(e),t=r=>yg(n,r);return Object.assign(t,n),t},Cg=e=>bg,Wd=200;function Sg(e){return e.replace(/~1/g,"/").replace(/~0/g,"~")}function Eg(e,n){const t=n.path.split("/").slice(1).map(Sg);if(t.length===0)return n.op==="remove"?void 0:n.value;const r=l=>Array.isArray(l)?[...l]:l&&typeof l=="object"?{...l}:l,s=r(e);let i=s;for(let l=0;l<t.length-1;l++){if(i===null||typeof i!="object")throw new Error(`patch parent missing at ${n.path}`);const c=t[l],d=i[c],u=r(d);i[c]=u,i=u}if(i===null||typeof i!="object")throw new Error(`patch parent missing at ${n.path}`);const o=t[t.length-1];if(Array.isArray(i)){const l=o==="-"?i.length:Number(o);if(!Number.isInteger(l)||l<0)throw new Error(`patch array index out of bounds at ${n.path}`);if(n.op==="remove"){if(l>=i.length)throw new Error(`patch array index out of bounds at ${n.path}`);i.splice(l,1)}else if(n.op==="add"){if(l>i.length)throw new Error(`patch array index out of bounds at ${n.path}`);i.splice(l,0,n.value)}else{if(l>=i.length)throw new Error(`patch array index out of bounds at ${n.path}`);i[l]=n.value}}else{const l=i;n.op==="remove"?delete l[o]:l[o]=n.value}return s}function ih(e,n){let t=e;for(const r of n.ops)t=Eg(t,r);return{...t,rev:n.headRev}}function Do(e,n){const r=[...n.filter(l=>l.headRev>e.rev)].sort((l,c)=>l.baseRev-c.baseRev||l.headRev-c.headRev);let s=e,i=!0;for(;i;){i=!1;const l=r.findIndex(d=>d.baseRev===s.rev);if(l<0)break;const[c]=r.splice(l,1);try{s=ih(s,c)}catch{break}i=!0}const o=r.length>0&&!r.some(l=>l.baseRev===s.rev);return{snapshot:s,pending:r,gap:o}}function Fo(e,n){if(e.some(r=>r.baseRev===n.baseRev&&r.headRev===n.headRev))return e;const t=[...e,n];return t.length>Wd?t.slice(t.length-Wd):t}const D=Cg()(e=>({snapshot:null,connected:!1,streams:{},pending:[],resyncSeq:0,setSnapshot:n=>e(t=>{if(t.snapshot&&n.rev<t.snapshot.rev)return t;const r=Do(n,t.pending);return{snapshot:r.snapshot,pending:r.pending,resyncSeq:r.gap?t.resyncSeq+1:t.resyncSeq}}),setConnected:n=>e({connected:n}),applyEvent:n=>e(t=>{switch(n.type){case"snapshot":{const r=n.snapshot;if(t.snapshot&&r.rev<t.snapshot.rev)return t;const s=Do(r,t.pending);return{snapshot:s.snapshot,streams:{},pending:s.pending,resyncSeq:s.gap?t.resyncSeq+1:t.resyncSeq}}case"patch":{if(!t.snapshot)return{pending:Fo(t.pending,n)};if(n.baseRev===t.snapshot.rev){let r;try{r=ih(t.snapshot,n)}catch{return{pending:Fo(t.pending,n),resyncSeq:t.resyncSeq+1}}const s=Do(r,t.pending);return{snapshot:s.snapshot,streams:{},pending:s.pending,resyncSeq:s.gap?t.resyncSeq+1:t.resyncSeq}}return n.baseRev<t.snapshot.rev?t:{pending:Fo(t.pending,n),resyncSeq:t.resyncSeq+1}}case"job":{if(!t.snapshot)return t;const r=t.snapshot.jobs.map(s=>s.id===n.job.id?n.job:s);return{snapshot:{...t.snapshot,jobs:r}}}case"text":{const r=n.threadId??n.cardId;if(!r)return t;const s=t.streams[r]??"";return{streams:{...t.streams,[r]:(s+n.delta).slice(-4e3)}}}default:return t}}),updateJob:n=>e(t=>t.snapshot?{snapshot:{...t.snapshot,jobs:t.snapshot.jobs.map(r=>r.id===n.id?n:r)}}:t),clear:()=>e({snapshot:null,streams:{},pending:[],resyncSeq:0})})),Vd="[0-9a-fA-F]{4,64}",jg="(\\d+)(?:-(\\d+))?";function Kd(e){const n=e.match(new RegExp(`^${jg}$`));if(!n)return null;const t=Number(n[1]),r=n[2]!==void 0?Number(n[2]):t;return!Number.isSafeInteger(t)||!Number.isSafeInteger(r)||t<1||r<t?null:{start:t,end:r}}function Ng(e){const n=e.lastIndexOf("@");return n<0?{head:e}:{head:e.slice(0,n),sha:e.slice(n+1)}}function no(e){if(!e||e.length>1024)return null;const n=e.indexOf(":");if(n<0)return null;const t=e.slice(0,n),r=e.slice(n+1);if(!r)return null;switch(t){case"diff":{const s=r.match(new RegExp(`^([^:@]+):(\\d+(?:-\\d+)?)(?:@(${Vd}))?$`));if(!s)return null;const i=Kd(s[2]);return i?{kind:"diff",fileKey:s[1],...i,sha:s[3]}:null}case"h":{const s=r.match(/^([^:@]+):([^:@]+)$/);return!s||!s[2]?null:{kind:"h",fileKey:s[1],contentHash:s[2]}}case"code":{const{head:s,sha:i}=Ng(r);if(i!==void 0&&!new RegExp(`^${Vd}$`).test(i))return null;const o=s.match(/^(.*):(\d+(?:-\d+)?)$/);if(!o||!o[1])return null;const l=Kd(o[2]);return l?{kind:"code",path:o[1],...l,sha:i}:null}case"desc":{const s=r.match(/^([^:@]+)(?:@([^:@]+))?$/);return s?{kind:"desc",paragraph:s[1],rev:s[2]}:null}case"card":{const s=r.match(/^([^:#@]+)(?:#([^:#@]+))?$/);return s?{kind:"card",cardId:s[1],blockId:s[2]}:null}case"page":return/[:#@]/.test(r)?null:{kind:"page",pageId:r};case"concept":return/[:#@]/.test(r)?null:{kind:"concept",slug:r};case"ann":return/[:#@]/.test(r)?null:{kind:"ann",id:r};default:return null}}const Lg=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;function Vs(e){return e.startsWith("a/")||e.startsWith("b/")?e.slice(2):e}function Tg(e){const n=[];let t=null,r={},s=null,i=0,o=0;const l=()=>{const u=r;r={};const p={path:u.renameTo??u.newPath??u.renameFrom??u.oldPath??"unknown",...u.renameFrom!==void 0?{oldPath:u.renameFrom}:{},isNew:u.isNew??!1,isDeleted:u.isDeleted??!1,isRename:u.renameFrom!==void 0,isBinary:u.isBinary??!1,hunks:[]};return t=p,s=null,p},c=()=>{t===null&&(r.oldPath!==void 0||r.newPath!==void 0)&&(t=l()),t&&n.push(t),t=null,s=null},d=e.split(`
`);d.length>0&&d[d.length-1]===""&&d.pop();for(const u of d){if(u.startsWith("diff --git ")){c();const v=u.match(/^diff --git (\S+) (\S+)(?: |$)/);r={oldPath:v?Vs(v[1]):void 0,newPath:v?Vs(v[2]):void 0};continue}if(u.startsWith("Binary files ")){r.isBinary=!0;continue}if(u.startsWith("rename from ")){r.renameFrom=u.slice(12);continue}if(u.startsWith("rename to ")){r.renameTo=u.slice(10);continue}if(u.startsWith("new file mode")){r.isNew=!0;continue}if(u.startsWith("deleted file mode")){r.isDeleted=!0;continue}if(u.startsWith("--- ")){const v=u.slice(4).trim().split("	")[0];v==="/dev/null"?r.isNew=!0:t===null&&(r.oldPath=Vs(v));continue}if(u.startsWith("+++ ")){const v=u.slice(4).trim().split("	")[0];v==="/dev/null"?r.isDeleted=!0:r.newPath=Vs(v),l();continue}const f=u.match(Lg);if(f){const v=t??l();i=Number(f[1]),o=Number(f[2]),s={header:u,...f[3]?{context:f[3]}:{},oldStart:i,oldEnd:i,newStart:o,newEnd:o,added:0,removed:0,lines:[],noNewline:!1},v.hunks.push(s);continue}if(u.startsWith("\\")){s&&/no newline/i.test(u)&&(s.noNewline=!0);continue}if(s===null||t===null)continue;const p=u[0],A=u.slice(1);if(p==="+")s.lines.push({kind:"add",newLine:o,text:A}),s.newEnd=o,o+=1,s.added+=1;else if(p==="-")s.lines.push({kind:"del",oldLine:i,text:A}),s.oldEnd=i,i+=1,s.removed+=1;else if(p===" ")s.lines.push({kind:"ctx",oldLine:i,newLine:o,text:A}),s.oldEnd=i,s.newEnd=o,i+=1,o+=1;else{if(u==="")continue;s=null}}return c(),n}const Rg=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];function Nn(e,n){return e>>>n|e<<32-n}function Pg(e){const n=[];for(let v=0;v<e.length;v++){let x=e.charCodeAt(v);if(x>=55296&&x<=56319&&v+1<e.length){const w=e.charCodeAt(v+1);w>=56320&&w<=57343&&(x=65536+(x-55296<<10)+(w-56320),v++)}x<128?n.push(x):x<2048?n.push(192|x>>6,128|x&63):x<65536?n.push(224|x>>12,128|x>>6&63,128|x&63):n.push(240|x>>18,128|x>>12&63,128|x>>6&63,128|x&63)}const t=n.length*8;for(n.push(128);n.length%64!==56;)n.push(0);const r=Math.floor(t/4294967296),s=t>>>0;n.push(r>>>24&255,r>>>16&255,r>>>8&255,r&255,s>>>24&255,s>>>16&255,s>>>8&255,s&255);let i=1779033703,o=3144134277,l=1013904242,c=2773480762,d=1359893119,u=2600822924,f=528734635,p=1541459225;const A=new Array(64);for(let v=0;v<n.length;v+=64){for(let S=0;S<16;S++)A[S]=n[v+S*4]<<24|n[v+S*4+1]<<16|n[v+S*4+2]<<8|n[v+S*4+3]|0;for(let S=16;S<64;S++){const N=Nn(A[S-15],7)^Nn(A[S-15],18)^A[S-15]>>>3,M=Nn(A[S-2],17)^Nn(A[S-2],19)^A[S-2]>>>10;A[S]=A[S-16]+N+A[S-7]+M|0}let x=i,w=o,g=l,m=c,k=d,b=u,y=f,C=p;for(let S=0;S<64;S++){const N=Nn(k,6)^Nn(k,11)^Nn(k,25),M=k&b^~k&y,R=C+N+M+Rg[S]+A[S]|0,O=Nn(x,2)^Nn(x,13)^Nn(x,22),_=x&w^x&g^w&g,ae=O+_|0;C=y,y=b,b=k,k=m+R|0,m=g,g=w,w=x,x=R+ae|0}i=i+x|0,o=o+w|0,l=l+g|0,c=c+m|0,d=d+k|0,u=u+b|0,f=f+y|0,p=p+C|0}return[i,o,l,c,d,u,f,p].map(v=>(v>>>0).toString(16).padStart(8,"0")).join("")}const Mg=16;function Bg(e){return`${e.kind}:${e.text.replace(/\s+/g,"")}`}function Dg(e){return e.map(Bg).join(`
`)}function Fg(e){return Pg(Dg(e)).slice(0,Mg)}const Ig=/(^|\/)(tests?|__tests__|test|spec|e2e)($|\/)/,Og=/(^|\/)(test[_-].*|.*[_-]test|.*\.(test|spec))\.[A-Za-z0-9]+$|^.*\.(test|spec)\.[A-Za-z0-9]+$/,Hg=/\.(md|markdown|rst|txt|adoc|textile)$/i,zg=/(^|\/)(docs|documentation|changelog|changes|news)($|\/)/i,_d=new Set(["dockerfile","containerfile","makefile","cmakelists.txt","package.json","package-lock.json","tsconfig.json","jsconfig.json",".eslintrc",".prettierrc","pyproject.toml","setup.cfg","tox.ini","cargo.toml","cargo.lock","go.mod","go.sum","gemfile","gemfile.lock","pom.xml","build.gradle","composer.json","cmakelists",".gitignore",".gitattributes",".gitmodules","docker-compose.yml","docker-compose.yaml"]),Ug=/\.(ya?ml|toml|ini|cfg|conf|json5|jsonc|properties|env)$/i,Wg=/(^|\/)(config|configs|settings|\.github|\.vscode|\.circleci)($|\/)/,Vg=/(^|\/)(dist|build|out|target|vendor|node_modules|__pycache__|\.next|coverage)($|\/)|\.(min\.js|min\.css|bundle\.js|bundle\.css|map|lock\.data|snap)$/i;function Kg(e,n={}){var i,o;const t=e.toLowerCase(),r=t.split("/").pop()??t;if((i=n.linguistGenerated)!=null&&i.has(e)||(o=n.linguistGenerated)!=null&&o.has(r)||Vg.test(t))return"generated";if(Ig.test(t)||Og.test(t))return"tests";if(Hg.test(t)||zg.test(t))return"docs";const s=r.startsWith(".")?r.slice(1):r;return _d.has(r)||_d.has(s)||Ug.test(t)||Wg.test(t)?"config":"source"}function _g(e){return e.replace(/[^A-Za-z0-9_.-]/g,"-")}const Gg=/^(?:from\s+\S+\s+import\s|import\s|export\s+(?:.*\s+from\s+)?|#include\s|using\s+[\w:.]+\s*;|use\s+[\w:]+)/,qg=/^[)},\]]/,Qg=/^["']?[\w$.*{}[\] ]+["']?,$/;function Zg(e,n){const t=e.lines.filter(i=>i.kind!=="ctx");if(t.length<=1)return;if(n.generatedFlag===!0||n.category==="generated")return"generated";if(n.category==="docs"||n.category==="config")return"docs / config";const r=t.map(i=>i.text.trim()).filter(Boolean);if(r.length===0)return;if(r.every(i=>Gg.test(i)||qg.test(i)||Qg.test(i)))return"imports"}function Yg(e,n={}){const t=n.linguistGenerated??new Set;return e.map(r=>{const s=Kg(r.path,{linguistGenerated:t}),i=_g(r.path),o=r.hunks.map(l=>{const c=Fg(l.lines),d=Zg(l,{category:s,generatedFlag:t.has(r.path)});return{contentHash:c,header:l.header,...l.context!==void 0?{context:l.context}:{},newStart:l.newStart,newEnd:l.newEnd,oldStart:l.oldStart,oldEnd:l.oldEnd,added:l.added,removed:l.removed,lines:l.lines.map(u=>({...u})),...l.noNewline?{noNewline:!0}:{},...d!==void 0?{hiddenReason:d}:{}}});return{fileKey:i,path:r.path,category:s,hunks:o,...r.oldPath!==void 0?{oldPath:r.oldPath}:{},...r.isNew?{isNew:!0}:{},...r.isDeleted?{isDeleted:!0}:{},...r.isRename?{isRename:!0}:{},...r.isBinary?{isBinary:!0}:{}}})}const Xg=[{key:"conn",path:"src/urllib3/connection.py",gen:!1,diff:`diff --git a/src/urllib3/connection.py b/src/urllib3/connection.py
index 443cb01be1..bdcc1e493e 100644
--- a/src/urllib3/connection.py
+++ b/src/urllib3/connection.py
@@ -77,6 +77,37 @@ class BaseSSLError(BaseException):  # type: ignore[no-redef]
 RECENT_DATE = datetime.date(2025, 1, 1)
 
 _CONTAINS_CONTROL_CHAR_RE = re.compile(r"[^-!#$%&'*+.^_\`|~0-9a-zA-Z]")
+# Starting the optional OWS match at the beginning of a whitespace run avoids
+# quadratic backtracking for long header values.
+_OBSOLETE_FOLD_RE = re.compile(r"(?:(?<![ \\t])[ \\t]+)?\\r\\n[ \\t]+")
+
+
+def _normalize_header_value(value: str) -> str:
+    if "\\r\\n" not in value:
+        return value
+    return _OBSOLETE_FOLD_RE.sub(" ", value)
+
+
+def _normalize_header_values(
+    message: http.client.HTTPMessage,
+) -> list[tuple[str, str]]:
+    header_items = message.items()
+    headers_changed = False
+    for index, (name, value) in enumerate(header_items):
+        normalized_value = _normalize_header_value(value)
+        if normalized_value != value:
+            header_items[index] = (name, normalized_value)
+            headers_changed = True
+
+    if headers_changed:
+        # Keep the original message in sync for downstream consumers such as
+        # cookie jars while preserving its identity and header ordering.
+        for name, _ in header_items:
+            del message[name]
+        for name, value in header_items:
+            message[name] = value
+
+    return header_items
 
 
 class HTTPConnection(_HTTPConnection):
@@ -616,7 +647,8 @@ def getresponse(  # type: ignore[override]
                 exc_info=True,
             )
 
-        headers = HTTPHeaderDict(httplib_response.msg.items())
+        header_items = _normalize_header_values(httplib_response.msg)
+        headers = HTTPHeaderDict(header_items)
 
         response = HTTPResponse(
             body=httplib_response,
`},{key:"tconn",path:"test/test_connection.py",gen:!1,diff:`diff --git a/test/test_connection.py b/test/test_connection.py
index 783a1aed6a..12806072d8 100644
--- a/test/test_connection.py
+++ b/test/test_connection.py
@@ -3,7 +3,7 @@
 import datetime
 import socket
 import typing
-from http.client import ResponseNotReady
+from http.client import HTTPMessage, ResponseNotReady
 from unittest import mock
 
 import pytest
@@ -14,6 +14,8 @@
     HTTPConnection,
     HTTPSConnection,
     _match_hostname,
+    _normalize_header_value,
+    _normalize_header_values,
     _url_from_connection,
     _wrap_proxy_error,
 )
@@ -209,6 +211,43 @@ def test_recent_date(self) -> None:
         two_years = datetime.timedelta(days=365 * 2)
         assert RECENT_DATE > (datetime.datetime.today() - two_years).date()
 
+    @pytest.mark.parametrize(
+        ("value", "expected"),
+        [
+            ("ordinary\\tvalue", "ordinary\\tvalue"),
+            ("before \\t\\r\\n\\t  after", "before after"),
+            ("one\\r\\n two\\t\\r\\n\\tthree", "one two three"),
+            ("one\\r\\n \\r\\n\\tthree", "one  three"),
+        ],
+    )
+    def test_normalize_header_value(self, value: str, expected: str) -> None:
+        assert _normalize_header_value(value) == expected
+
+    def test_normalize_header_values_preserves_message(self) -> None:
+        message = HTTPMessage()
+        message["X-First"] = "one"
+        message["Set-Cookie"] = "a=1 \\r\\n two"
+        message["X-Second"] = "three"
+        message["Set-Cookie"] = "b=2"
+        message.set_payload("payload")
+        defects = message.defects
+        policy = message.policy
+
+        header_items = _normalize_header_values(message)
+
+        expected = [
+            ("X-First", "one"),
+            ("Set-Cookie", "a=1 two"),
+            ("X-Second", "three"),
+            ("Set-Cookie", "b=2"),
+        ]
+        assert header_items == expected
+        assert message.items() == expected
+        assert message.get_all("Set-Cookie") == ["a=1 two", "b=2"]
+        assert message.get_payload() == "payload"
+        assert message.defects is defects
+        assert message.policy is policy
+
     def test_HTTPSConnection_default_socket_options(self) -> None:
         conn = HTTPSConnection("not.a.real.host", port=443)
         assert conn.socket_options == [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]
`},{key:"tsock",path:"test/with_dummyserver/test_socketlevel.py",gen:!1,diff:`diff --git a/test/with_dummyserver/test_socketlevel.py b/test/with_dummyserver/test_socketlevel.py
index cd7df323c1..54a2989cd7 100644
--- a/test/with_dummyserver/test_socketlevel.py
+++ b/test/with_dummyserver/test_socketlevel.py
@@ -37,6 +37,7 @@
 from urllib3 import (
     BaseHTTPResponse,
     HTTPConnectionPool,
+    HTTPResponse,
     HTTPSConnectionPool,
     ProxyManager,
     util,
@@ -88,6 +89,62 @@ def multicookie_response_handler(listener: socket.socket) -> None:
             assert r.headers == {"set-cookie": "foo=1, bar=1"}
             assert r.headers.getlist("set-cookie") == ["foo=1", "bar=1"]
 
+    def test_obsolete_line_folding_is_unfolded(self) -> None:
+        def folded_cookie_response_handler(listener: socket.socket) -> None:
+            with listener.accept()[0] as sock:
+                buf = b""
+                while not buf.endswith(b"\\r\\n\\r\\n"):
+                    buf += sock.recv(65536)
+
+                sock.sendall(
+                    b"HTTP/1.1 200 OK\\r\\n"
+                    b"Set-Cookie: ___utmvbtouVBFmB=gZg\\r\\n"
+                    b"    XbNOjalT: Lte; path=/; Max-Age=900\\r\\n"
+                    b"Set-Cookie: ordinary=1; Path=/\\r\\n"
+                    b"Fold-Space-Space: before \\r\\n"
+                    b" after\\r\\n"
+                    b"Fold-Space-Tab: before \\r\\n"
+                    b"\\tafter\\r\\n"
+                    b"Fold-Tab-Space: before\\t\\r\\n"
+                    b" after\\r\\n"
+                    b"Fold-Tab-Tab: before\\t\\r\\n"
+                    b"\\tafter\\r\\n"
+                    b"Fold-Mixed-Repeated: one \\t\\r\\n"
+                    b"\\t  two\\t \\r\\n"
+                    b" \\tthree\\r\\n"
+                    b"Ordinary: one\\t two\\r\\n"
+                    b"Content-Length: 0\\r\\n"
+                    b"\\r\\n"
+                )
+
+        self._start_server(folded_cookie_response_handler)
+        with HTTPConnectionPool(self.host, self.port) as pool:
+            r = pool.request("GET", "/", retries=0)
+
+            assert r.headers.getlist("set-cookie") == [
+                "___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900",
+                "ordinary=1; Path=/",
+            ]
+            assert r.headers["fold-space-space"] == "before after"
+            assert r.headers["fold-space-tab"] == "before after"
+            assert r.headers["fold-tab-space"] == "before after"
+            assert r.headers["fold-tab-tab"] == "before after"
+            assert r.headers["fold-mixed-repeated"] == "one two three"
+            assert r.headers["ordinary"] == "one\\t two"
+            assert r.headers["content-length"] == "0"
+            assert all(
+                "\\r" not in value and "\\n" not in value for value in r.headers.values()
+            )
+
+            assert isinstance(r, HTTPResponse)
+            assert r._original_response is not None
+            assert r._original_response.headers is r._original_response.msg
+            assert r._original_response.msg.get_all("set-cookie") == [
+                "___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900",
+                "ordinary=1; Path=/",
+            ]
+            assert r._original_response.msg["fold-mixed-repeated"] == "one two three"
+
 
 class TestSNI(SocketDummyServerTestCase):
     def test_hostname_in_first_request_packet(self) -> None:
`},{key:"log",path:"changelog/1362.bugfix.rst",gen:!1,diff:`diff --git a/changelog/1362.bugfix.rst b/changelog/1362.bugfix.rst
new file mode 100644
index 0000000000..ef105d137d
--- /dev/null
+++ b/changelog/1362.bugfix.rst
@@ -0,0 +1,3 @@
+Fixed response header handling to replace obsolete folded header lines
+(\`obs-fold\`) with spaces in accordance with RFC 9112, preventing raw
+CRLF sequences from appearing in header values such as \`\`Set-Cookie\`\`.
`}],Kt=Yg(Xg.flatMap(e=>Tg(e.diff))),Gd="src-urllib3-connection.py",Io="test-test_connection.py",qd="test-with_dummyserver-test_socketlevel.py",Jg="changelog-1362.bugfix.rst",$g={[`${Gd}:0`]:"Adds `_OBSOLETE_FOLD_RE` and two helpers. `_normalize_header_value` turns each fold into one space, with a fast path for values without CRLF. `_normalize_header_values` applies it to every header and, if anything changed, rewrites the original `HTTPMessage` in place, keeping order and duplicates.",[`${Gd}:1`]:"`getresponse()` now builds `HTTPHeaderDict` from the normalized header list instead of the raw `HTTPMessage` items. This is the only call site.",[`${Io}:0`]:"Imports `HTTPMessage` for the new unit test.",[`${Io}:1`]:"Imports the two new helpers.",[`${Io}:2`]:"Unit tests: the value helper on four inputs (including two adjacent folds), and the message helper preserving order, duplicates, payload, defects and policy.",[`${qd}:0`]:"Imports `HTTPResponse` for an isinstance check.",[`${qd}:1`]:"Socket-level test: a real response with folded `Set-Cookie` and every SP/HTAB combination around CRLF, checked through both `r.headers` and the original message.",[`${Jg}:0`]:"Changelog entry for the fix."},e0=`{
  "review": {
    "id": "urllib3-5020",
    "repoId": "urllib3/urllib3",
    "branch": "main",
    "prNumber": 5020,
    "versions": [
      {
        "n": 1,
        "headSha": "bdcc1e493e",
        "mergeBaseSha": "443cb01be1",
        "baseRef": "main",
        "fetchedAt": 1760000000000,
        "idMapping": {}
      }
    ],
    "currentVersion": 1,
    "createdAt": 1760000000000
  },
  "version": {
    "n": 1,
    "headSha": "bdcc1e493e",
    "mergeBaseSha": "443cb01be1",
    "baseRef": "main",
    "fetchedAt": 1760000000000,
    "idMapping": {}
  },
  "files": [
    {
      "fileKey": "src-urllib3-connection.py",
      "path": "src/urllib3/connection.py",
      "category": "source",
      "hunks": [
        {
          "contentHash": "fa60105d7fcbe8fe",
          "header": "@@ -77,6 +77,37 @@ class BaseSSLError(BaseException):  # type: ignore[no-redef]",
          "context": "class BaseSSLError(BaseException):  # type: ignore[no-redef]",
          "newStart": 77,
          "newEnd": 113,
          "oldStart": 77,
          "oldEnd": 82,
          "added": 31,
          "removed": 0,
          "lines": [
            {
              "kind": "ctx",
              "oldLine": 77,
              "newLine": 77,
              "text": "RECENT_DATE = datetime.date(2025, 1, 1)"
            },
            {
              "kind": "ctx",
              "oldLine": 78,
              "newLine": 78,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 79,
              "newLine": 79,
              "text": "_CONTAINS_CONTROL_CHAR_RE = re.compile(r\\"[^-!#$%&'*+.^_\`|~0-9a-zA-Z]\\")"
            },
            {
              "kind": "add",
              "newLine": 80,
              "text": "# Starting the optional OWS match at the beginning of a whitespace run avoids"
            },
            {
              "kind": "add",
              "newLine": 81,
              "text": "# quadratic backtracking for long header values."
            },
            {
              "kind": "add",
              "newLine": 82,
              "text": "_OBSOLETE_FOLD_RE = re.compile(r\\"(?:(?<![ \\\\t])[ \\\\t]+)?\\\\r\\\\n[ \\\\t]+\\")"
            },
            {
              "kind": "add",
              "newLine": 83,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 84,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 85,
              "text": "def _normalize_header_value(value: str) -> str:"
            },
            {
              "kind": "add",
              "newLine": 86,
              "text": "    if \\"\\\\r\\\\n\\" not in value:"
            },
            {
              "kind": "add",
              "newLine": 87,
              "text": "        return value"
            },
            {
              "kind": "add",
              "newLine": 88,
              "text": "    return _OBSOLETE_FOLD_RE.sub(\\" \\", value)"
            },
            {
              "kind": "add",
              "newLine": 89,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 90,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 91,
              "text": "def _normalize_header_values("
            },
            {
              "kind": "add",
              "newLine": 92,
              "text": "    message: http.client.HTTPMessage,"
            },
            {
              "kind": "add",
              "newLine": 93,
              "text": ") -> list[tuple[str, str]]:"
            },
            {
              "kind": "add",
              "newLine": 94,
              "text": "    header_items = message.items()"
            },
            {
              "kind": "add",
              "newLine": 95,
              "text": "    headers_changed = False"
            },
            {
              "kind": "add",
              "newLine": 96,
              "text": "    for index, (name, value) in enumerate(header_items):"
            },
            {
              "kind": "add",
              "newLine": 97,
              "text": "        normalized_value = _normalize_header_value(value)"
            },
            {
              "kind": "add",
              "newLine": 98,
              "text": "        if normalized_value != value:"
            },
            {
              "kind": "add",
              "newLine": 99,
              "text": "            header_items[index] = (name, normalized_value)"
            },
            {
              "kind": "add",
              "newLine": 100,
              "text": "            headers_changed = True"
            },
            {
              "kind": "add",
              "newLine": 101,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 102,
              "text": "    if headers_changed:"
            },
            {
              "kind": "add",
              "newLine": 103,
              "text": "        # Keep the original message in sync for downstream consumers such as"
            },
            {
              "kind": "add",
              "newLine": 104,
              "text": "        # cookie jars while preserving its identity and header ordering."
            },
            {
              "kind": "add",
              "newLine": 105,
              "text": "        for name, _ in header_items:"
            },
            {
              "kind": "add",
              "newLine": 106,
              "text": "            del message[name]"
            },
            {
              "kind": "add",
              "newLine": 107,
              "text": "        for name, value in header_items:"
            },
            {
              "kind": "add",
              "newLine": 108,
              "text": "            message[name] = value"
            },
            {
              "kind": "add",
              "newLine": 109,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 110,
              "text": "    return header_items"
            },
            {
              "kind": "ctx",
              "oldLine": 80,
              "newLine": 111,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 81,
              "newLine": 112,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 82,
              "newLine": 113,
              "text": "class HTTPConnection(_HTTPConnection):"
            }
          ]
        },
        {
          "contentHash": "b355d2096d4d7f39",
          "header": "@@ -616,7 +647,8 @@ def getresponse(  # type: ignore[override]",
          "context": "def getresponse(  # type: ignore[override]",
          "newStart": 647,
          "newEnd": 654,
          "oldStart": 616,
          "oldEnd": 622,
          "added": 2,
          "removed": 1,
          "lines": [
            {
              "kind": "ctx",
              "oldLine": 616,
              "newLine": 647,
              "text": "                exc_info=True,"
            },
            {
              "kind": "ctx",
              "oldLine": 617,
              "newLine": 648,
              "text": "            )"
            },
            {
              "kind": "ctx",
              "oldLine": 618,
              "newLine": 649,
              "text": ""
            },
            {
              "kind": "del",
              "oldLine": 619,
              "text": "        headers = HTTPHeaderDict(httplib_response.msg.items())"
            },
            {
              "kind": "add",
              "newLine": 650,
              "text": "        header_items = _normalize_header_values(httplib_response.msg)"
            },
            {
              "kind": "add",
              "newLine": 651,
              "text": "        headers = HTTPHeaderDict(header_items)"
            },
            {
              "kind": "ctx",
              "oldLine": 620,
              "newLine": 652,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 621,
              "newLine": 653,
              "text": "        response = HTTPResponse("
            },
            {
              "kind": "ctx",
              "oldLine": 622,
              "newLine": 654,
              "text": "            body=httplib_response,"
            }
          ]
        }
      ]
    },
    {
      "fileKey": "test-test_connection.py",
      "path": "test/test_connection.py",
      "category": "tests",
      "hunks": [
        {
          "contentHash": "6cfb09ec98cba6ba",
          "header": "@@ -3,7 +3,7 @@",
          "newStart": 3,
          "newEnd": 9,
          "oldStart": 3,
          "oldEnd": 9,
          "added": 1,
          "removed": 1,
          "lines": [
            {
              "kind": "ctx",
              "oldLine": 3,
              "newLine": 3,
              "text": "import datetime"
            },
            {
              "kind": "ctx",
              "oldLine": 4,
              "newLine": 4,
              "text": "import socket"
            },
            {
              "kind": "ctx",
              "oldLine": 5,
              "newLine": 5,
              "text": "import typing"
            },
            {
              "kind": "del",
              "oldLine": 6,
              "text": "from http.client import ResponseNotReady"
            },
            {
              "kind": "add",
              "newLine": 6,
              "text": "from http.client import HTTPMessage, ResponseNotReady"
            },
            {
              "kind": "ctx",
              "oldLine": 7,
              "newLine": 7,
              "text": "from unittest import mock"
            },
            {
              "kind": "ctx",
              "oldLine": 8,
              "newLine": 8,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 9,
              "newLine": 9,
              "text": "import pytest"
            }
          ],
          "hiddenReason": "imports"
        },
        {
          "contentHash": "92cf4ca541bdb0f2",
          "header": "@@ -14,6 +14,8 @@",
          "newStart": 14,
          "newEnd": 21,
          "oldStart": 14,
          "oldEnd": 19,
          "added": 2,
          "removed": 0,
          "lines": [
            {
              "kind": "ctx",
              "oldLine": 14,
              "newLine": 14,
              "text": "    HTTPConnection,"
            },
            {
              "kind": "ctx",
              "oldLine": 15,
              "newLine": 15,
              "text": "    HTTPSConnection,"
            },
            {
              "kind": "ctx",
              "oldLine": 16,
              "newLine": 16,
              "text": "    _match_hostname,"
            },
            {
              "kind": "add",
              "newLine": 17,
              "text": "    _normalize_header_value,"
            },
            {
              "kind": "add",
              "newLine": 18,
              "text": "    _normalize_header_values,"
            },
            {
              "kind": "ctx",
              "oldLine": 17,
              "newLine": 19,
              "text": "    _url_from_connection,"
            },
            {
              "kind": "ctx",
              "oldLine": 18,
              "newLine": 20,
              "text": "    _wrap_proxy_error,"
            },
            {
              "kind": "ctx",
              "oldLine": 19,
              "newLine": 21,
              "text": ")"
            }
          ],
          "hiddenReason": "imports"
        },
        {
          "contentHash": "b33779988cee5f8a",
          "header": "@@ -209,6 +211,43 @@ def test_recent_date(self) -> None:",
          "context": "def test_recent_date(self) -> None:",
          "newStart": 211,
          "newEnd": 253,
          "oldStart": 209,
          "oldEnd": 214,
          "added": 37,
          "removed": 0,
          "lines": [
            {
              "kind": "ctx",
              "oldLine": 209,
              "newLine": 211,
              "text": "        two_years = datetime.timedelta(days=365 * 2)"
            },
            {
              "kind": "ctx",
              "oldLine": 210,
              "newLine": 212,
              "text": "        assert RECENT_DATE > (datetime.datetime.today() - two_years).date()"
            },
            {
              "kind": "ctx",
              "oldLine": 211,
              "newLine": 213,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 214,
              "text": "    @pytest.mark.parametrize("
            },
            {
              "kind": "add",
              "newLine": 215,
              "text": "        (\\"value\\", \\"expected\\"),"
            },
            {
              "kind": "add",
              "newLine": 216,
              "text": "        ["
            },
            {
              "kind": "add",
              "newLine": 217,
              "text": "            (\\"ordinary\\\\tvalue\\", \\"ordinary\\\\tvalue\\"),"
            },
            {
              "kind": "add",
              "newLine": 218,
              "text": "            (\\"before \\\\t\\\\r\\\\n\\\\t  after\\", \\"before after\\"),"
            },
            {
              "kind": "add",
              "newLine": 219,
              "text": "            (\\"one\\\\r\\\\n two\\\\t\\\\r\\\\n\\\\tthree\\", \\"one two three\\"),"
            },
            {
              "kind": "add",
              "newLine": 220,
              "text": "            (\\"one\\\\r\\\\n \\\\r\\\\n\\\\tthree\\", \\"one  three\\"),"
            },
            {
              "kind": "add",
              "newLine": 221,
              "text": "        ],"
            },
            {
              "kind": "add",
              "newLine": 222,
              "text": "    )"
            },
            {
              "kind": "add",
              "newLine": 223,
              "text": "    def test_normalize_header_value(self, value: str, expected: str) -> None:"
            },
            {
              "kind": "add",
              "newLine": 224,
              "text": "        assert _normalize_header_value(value) == expected"
            },
            {
              "kind": "add",
              "newLine": 225,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 226,
              "text": "    def test_normalize_header_values_preserves_message(self) -> None:"
            },
            {
              "kind": "add",
              "newLine": 227,
              "text": "        message = HTTPMessage()"
            },
            {
              "kind": "add",
              "newLine": 228,
              "text": "        message[\\"X-First\\"] = \\"one\\""
            },
            {
              "kind": "add",
              "newLine": 229,
              "text": "        message[\\"Set-Cookie\\"] = \\"a=1 \\\\r\\\\n two\\""
            },
            {
              "kind": "add",
              "newLine": 230,
              "text": "        message[\\"X-Second\\"] = \\"three\\""
            },
            {
              "kind": "add",
              "newLine": 231,
              "text": "        message[\\"Set-Cookie\\"] = \\"b=2\\""
            },
            {
              "kind": "add",
              "newLine": 232,
              "text": "        message.set_payload(\\"payload\\")"
            },
            {
              "kind": "add",
              "newLine": 233,
              "text": "        defects = message.defects"
            },
            {
              "kind": "add",
              "newLine": 234,
              "text": "        policy = message.policy"
            },
            {
              "kind": "add",
              "newLine": 235,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 236,
              "text": "        header_items = _normalize_header_values(message)"
            },
            {
              "kind": "add",
              "newLine": 237,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 238,
              "text": "        expected = ["
            },
            {
              "kind": "add",
              "newLine": 239,
              "text": "            (\\"X-First\\", \\"one\\"),"
            },
            {
              "kind": "add",
              "newLine": 240,
              "text": "            (\\"Set-Cookie\\", \\"a=1 two\\"),"
            },
            {
              "kind": "add",
              "newLine": 241,
              "text": "            (\\"X-Second\\", \\"three\\"),"
            },
            {
              "kind": "add",
              "newLine": 242,
              "text": "            (\\"Set-Cookie\\", \\"b=2\\"),"
            },
            {
              "kind": "add",
              "newLine": 243,
              "text": "        ]"
            },
            {
              "kind": "add",
              "newLine": 244,
              "text": "        assert header_items == expected"
            },
            {
              "kind": "add",
              "newLine": 245,
              "text": "        assert message.items() == expected"
            },
            {
              "kind": "add",
              "newLine": 246,
              "text": "        assert message.get_all(\\"Set-Cookie\\") == [\\"a=1 two\\", \\"b=2\\"]"
            },
            {
              "kind": "add",
              "newLine": 247,
              "text": "        assert message.get_payload() == \\"payload\\""
            },
            {
              "kind": "add",
              "newLine": 248,
              "text": "        assert message.defects is defects"
            },
            {
              "kind": "add",
              "newLine": 249,
              "text": "        assert message.policy is policy"
            },
            {
              "kind": "add",
              "newLine": 250,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 212,
              "newLine": 251,
              "text": "    def test_HTTPSConnection_default_socket_options(self) -> None:"
            },
            {
              "kind": "ctx",
              "oldLine": 213,
              "newLine": 252,
              "text": "        conn = HTTPSConnection(\\"not.a.real.host\\", port=443)"
            },
            {
              "kind": "ctx",
              "oldLine": 214,
              "newLine": 253,
              "text": "        assert conn.socket_options == [(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)]"
            }
          ]
        }
      ]
    },
    {
      "fileKey": "test-with_dummyserver-test_socketlevel.py",
      "path": "test/with_dummyserver/test_socketlevel.py",
      "category": "tests",
      "hunks": [
        {
          "contentHash": "29382503b8689e5f",
          "header": "@@ -37,6 +37,7 @@",
          "newStart": 37,
          "newEnd": 43,
          "oldStart": 37,
          "oldEnd": 42,
          "added": 1,
          "removed": 0,
          "lines": [
            {
              "kind": "ctx",
              "oldLine": 37,
              "newLine": 37,
              "text": "from urllib3 import ("
            },
            {
              "kind": "ctx",
              "oldLine": 38,
              "newLine": 38,
              "text": "    BaseHTTPResponse,"
            },
            {
              "kind": "ctx",
              "oldLine": 39,
              "newLine": 39,
              "text": "    HTTPConnectionPool,"
            },
            {
              "kind": "add",
              "newLine": 40,
              "text": "    HTTPResponse,"
            },
            {
              "kind": "ctx",
              "oldLine": 40,
              "newLine": 41,
              "text": "    HTTPSConnectionPool,"
            },
            {
              "kind": "ctx",
              "oldLine": 41,
              "newLine": 42,
              "text": "    ProxyManager,"
            },
            {
              "kind": "ctx",
              "oldLine": 42,
              "newLine": 43,
              "text": "    util,"
            }
          ]
        },
        {
          "contentHash": "949dda852e448b55",
          "header": "@@ -88,6 +89,62 @@ def multicookie_response_handler(listener: socket.socket) -> None:",
          "context": "def multicookie_response_handler(listener: socket.socket) -> None:",
          "newStart": 89,
          "newEnd": 150,
          "oldStart": 88,
          "oldEnd": 93,
          "added": 56,
          "removed": 0,
          "lines": [
            {
              "kind": "ctx",
              "oldLine": 88,
              "newLine": 89,
              "text": "            assert r.headers == {\\"set-cookie\\": \\"foo=1, bar=1\\"}"
            },
            {
              "kind": "ctx",
              "oldLine": 89,
              "newLine": 90,
              "text": "            assert r.headers.getlist(\\"set-cookie\\") == [\\"foo=1\\", \\"bar=1\\"]"
            },
            {
              "kind": "ctx",
              "oldLine": 90,
              "newLine": 91,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 92,
              "text": "    def test_obsolete_line_folding_is_unfolded(self) -> None:"
            },
            {
              "kind": "add",
              "newLine": 93,
              "text": "        def folded_cookie_response_handler(listener: socket.socket) -> None:"
            },
            {
              "kind": "add",
              "newLine": 94,
              "text": "            with listener.accept()[0] as sock:"
            },
            {
              "kind": "add",
              "newLine": 95,
              "text": "                buf = b\\"\\""
            },
            {
              "kind": "add",
              "newLine": 96,
              "text": "                while not buf.endswith(b\\"\\\\r\\\\n\\\\r\\\\n\\"):"
            },
            {
              "kind": "add",
              "newLine": 97,
              "text": "                    buf += sock.recv(65536)"
            },
            {
              "kind": "add",
              "newLine": 98,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 99,
              "text": "                sock.sendall("
            },
            {
              "kind": "add",
              "newLine": 100,
              "text": "                    b\\"HTTP/1.1 200 OK\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 101,
              "text": "                    b\\"Set-Cookie: ___utmvbtouVBFmB=gZg\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 102,
              "text": "                    b\\"    XbNOjalT: Lte; path=/; Max-Age=900\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 103,
              "text": "                    b\\"Set-Cookie: ordinary=1; Path=/\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 104,
              "text": "                    b\\"Fold-Space-Space: before \\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 105,
              "text": "                    b\\" after\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 106,
              "text": "                    b\\"Fold-Space-Tab: before \\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 107,
              "text": "                    b\\"\\\\tafter\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 108,
              "text": "                    b\\"Fold-Tab-Space: before\\\\t\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 109,
              "text": "                    b\\" after\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 110,
              "text": "                    b\\"Fold-Tab-Tab: before\\\\t\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 111,
              "text": "                    b\\"\\\\tafter\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 112,
              "text": "                    b\\"Fold-Mixed-Repeated: one \\\\t\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 113,
              "text": "                    b\\"\\\\t  two\\\\t \\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 114,
              "text": "                    b\\" \\\\tthree\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 115,
              "text": "                    b\\"Ordinary: one\\\\t two\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 116,
              "text": "                    b\\"Content-Length: 0\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 117,
              "text": "                    b\\"\\\\r\\\\n\\""
            },
            {
              "kind": "add",
              "newLine": 118,
              "text": "                )"
            },
            {
              "kind": "add",
              "newLine": 119,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 120,
              "text": "        self._start_server(folded_cookie_response_handler)"
            },
            {
              "kind": "add",
              "newLine": 121,
              "text": "        with HTTPConnectionPool(self.host, self.port) as pool:"
            },
            {
              "kind": "add",
              "newLine": 122,
              "text": "            r = pool.request(\\"GET\\", \\"/\\", retries=0)"
            },
            {
              "kind": "add",
              "newLine": 123,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 124,
              "text": "            assert r.headers.getlist(\\"set-cookie\\") == ["
            },
            {
              "kind": "add",
              "newLine": 125,
              "text": "                \\"___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900\\","
            },
            {
              "kind": "add",
              "newLine": 126,
              "text": "                \\"ordinary=1; Path=/\\","
            },
            {
              "kind": "add",
              "newLine": 127,
              "text": "            ]"
            },
            {
              "kind": "add",
              "newLine": 128,
              "text": "            assert r.headers[\\"fold-space-space\\"] == \\"before after\\""
            },
            {
              "kind": "add",
              "newLine": 129,
              "text": "            assert r.headers[\\"fold-space-tab\\"] == \\"before after\\""
            },
            {
              "kind": "add",
              "newLine": 130,
              "text": "            assert r.headers[\\"fold-tab-space\\"] == \\"before after\\""
            },
            {
              "kind": "add",
              "newLine": 131,
              "text": "            assert r.headers[\\"fold-tab-tab\\"] == \\"before after\\""
            },
            {
              "kind": "add",
              "newLine": 132,
              "text": "            assert r.headers[\\"fold-mixed-repeated\\"] == \\"one two three\\""
            },
            {
              "kind": "add",
              "newLine": 133,
              "text": "            assert r.headers[\\"ordinary\\"] == \\"one\\\\t two\\""
            },
            {
              "kind": "add",
              "newLine": 134,
              "text": "            assert r.headers[\\"content-length\\"] == \\"0\\""
            },
            {
              "kind": "add",
              "newLine": 135,
              "text": "            assert all("
            },
            {
              "kind": "add",
              "newLine": 136,
              "text": "                \\"\\\\r\\" not in value and \\"\\\\n\\" not in value for value in r.headers.values()"
            },
            {
              "kind": "add",
              "newLine": 137,
              "text": "            )"
            },
            {
              "kind": "add",
              "newLine": 138,
              "text": ""
            },
            {
              "kind": "add",
              "newLine": 139,
              "text": "            assert isinstance(r, HTTPResponse)"
            },
            {
              "kind": "add",
              "newLine": 140,
              "text": "            assert r._original_response is not None"
            },
            {
              "kind": "add",
              "newLine": 141,
              "text": "            assert r._original_response.headers is r._original_response.msg"
            },
            {
              "kind": "add",
              "newLine": 142,
              "text": "            assert r._original_response.msg.get_all(\\"set-cookie\\") == ["
            },
            {
              "kind": "add",
              "newLine": 143,
              "text": "                \\"___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900\\","
            },
            {
              "kind": "add",
              "newLine": 144,
              "text": "                \\"ordinary=1; Path=/\\","
            },
            {
              "kind": "add",
              "newLine": 145,
              "text": "            ]"
            },
            {
              "kind": "add",
              "newLine": 146,
              "text": "            assert r._original_response.msg[\\"fold-mixed-repeated\\"] == \\"one two three\\""
            },
            {
              "kind": "add",
              "newLine": 147,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 91,
              "newLine": 148,
              "text": ""
            },
            {
              "kind": "ctx",
              "oldLine": 92,
              "newLine": 149,
              "text": "class TestSNI(SocketDummyServerTestCase):"
            },
            {
              "kind": "ctx",
              "oldLine": 93,
              "newLine": 150,
              "text": "    def test_hostname_in_first_request_packet(self) -> None:"
            }
          ]
        }
      ]
    },
    {
      "fileKey": "changelog-1362.bugfix.rst",
      "path": "changelog/1362.bugfix.rst",
      "category": "docs",
      "hunks": [
        {
          "contentHash": "d1c6f159e5ffb42d",
          "header": "@@ -0,0 +1,3 @@",
          "newStart": 1,
          "newEnd": 3,
          "oldStart": 0,
          "oldEnd": 0,
          "added": 3,
          "removed": 0,
          "lines": [
            {
              "kind": "add",
              "newLine": 1,
              "text": "Fixed response header handling to replace obsolete folded header lines"
            },
            {
              "kind": "add",
              "newLine": 2,
              "text": "(\`obs-fold\`) with spaces in accordance with RFC 9112, preventing raw"
            },
            {
              "kind": "add",
              "newLine": 3,
              "text": "CRLF sequences from appearing in header values such as \`\`Set-Cookie\`\`."
            }
          ],
          "hiddenReason": "docs / config"
        }
      ],
      "isNew": true
    }
  ],
  "description": {
    "html": "<div class=\\"desc\\"><h3>Unfold obsolete folded response headers</h3><p class=\\"para\\" id=\\"d-p1\\">Addresses the original obs-fold response-header case discussed in #1362. Python's <code>http.client</code> preserves obsolete folded response header lines in <code>HTTPMessage</code> values. This change replaces each RFC 9112 <code>OWS CRLF RWS</code> sequence with a single space before urllib3 or downstream consumers interpret the value.</p><h3>The normalization</h3><ul class=\\"para\\" id=\\"d-p2\\"><li>keeps urllib3's <code>HTTPHeaderDict</code> and the original <code>HTTPMessage</code> synchronized, preventing cookie consumers such as Requests from re-emitting raw CRLF;</li><li>preserves header names, ordering, duplicate fields, and parser state;</li><li>uses a common-case fast path and a linear-time pattern for long field values.</li></ul><h3>Tests</h3><p class=\\"para\\" id=\\"d-p3\\">The socket regression covers the original folded <code>Set-Cookie</code>, duplicate cookies, every SP/HTAB combination around CRLF, mixed and repeated whitespace, multiple folds, and ordinary headers. Focused unit coverage also verifies adjacent folds and preservation of the original message's order, duplicates, payload, policy, and defects.</p><p class=\\"para\\" id=\\"d-p4\\">This intentionally does not address the separate whitespace-before-colon/header name validation scope discussed on #1362.</p><h3>Validation performed</h3><ul class=\\"para\\" id=\\"d-p5\\"><li>full local suite: 2,279 passed, 333 skipped, 4 xfailed;</li><li>focused strict nox sessions on Python 3.12, 3.13, and 3.14;</li><li>pyupgrade, Black, isort, and flake8;</li><li>towncrier changelog validation;</li><li>source distribution and wheel builds;</li><li>end-to-end Requests cookie extraction and subsequent request serialization.</li></ul></div>",
    "rev": "1",
    "source": "pr",
    "editable": false,
    "restated": {
      "d-p1": [
        "b1",
        "b2"
      ],
      "d-p2": [
        "b2",
        "b1"
      ]
    }
  },
  "pages": [
    {
      "id": "root",
      "kind": "root",
      "title": "Unfold obsolete folded response headers",
      "saved": false,
      "cards": [
        {
          "id": "problem",
          "pageId": "root",
          "title": "The problem",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "HTTP/1.1 used to let a server continue a header value on the next line by starting that line with a space or tab. That's <a class=\\"cx\\" data-link=\\"concept:obs-fold\\">obsolete line folding</a>. Python's <code>http.client</code> keeps the folded value as it arrived, with the raw CRLF inside it, and urllib3 copied those values straight into its <a class=\\"cx\\" data-link=\\"concept:http-headers\\">HTTPHeaderDict</a>. A header such as <code>Set-Cookie</code> could therefore contain a hidden line break.  ",
                "simple": "Old servers sometimes split one header across two lines. Python keeps the line break inside the header's value, and urllib3 passed it along unchanged, so some header values contained hidden line breaks.",
                "deep": "A parser leaking its input format. A fold is an encoding detail: one value written across lines. RFC 9112 requires a recipient to replace each fold with spaces before interpreting the value. Keeping the CRLF lets the wire format leak into the value itself, and every consumer then has to unfold it again, or carries the line break further."
              },
              "citations": [
                {
                  "target": "desc:d-p1"
                },
                {
                  "target": "diff:src-urllib3-connection.py:650-651"
                }
              ]
            },
            {
              "type": "paragraph",
              "id": "b2",
              "text": {
                "standard": "The line break isn't just untidy. Libraries that copy cookies from the response, such as Requests, read <code>http.client</code>'s own message object and can send the value back out with the raw CRLF in it. That can split one header into two on the next request: <a class=\\"cx\\" data-link=\\"concept:header-injection\\">header injection</a>. Issue #1362 tracked the original report.  ",
                "simple": "Worse, other libraries copy these values into the next request, and the hidden line break can turn one header into two.",
                "deep": "A safety property. A header value must never contain CR or LF once it leaves the parser, because anything that writes it out again treats the line break as the end of the header. Normalizing at the one point where urllib3 turns the parsed response into its own types fixes every consumer at once, as long as the original message is fixed too."
              },
              "citations": [
                {
                  "target": "desc:d-p2"
                },
                {
                  "target": "desc:d-p1"
                }
              ]
            }
          ],
          "undoStack": []
        },
        {
          "id": "central",
          "pageId": "root",
          "title": "The central change",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "urllib3 now unfolds header values right after <code>http.client</code> parses the response, as restated in <a class=\\"cx\\" data-link=\\"card:problem#b1\\">the problem</a>. A new helper replaces each fold (optional whitespace, CRLF, then at least one space or tab) with a single space. It updates both urllib3's <code>HTTPHeaderDict</code> and the original <code>HTTPMessage</code>, so code reading either one sees the same clean values.  ",
                "simple": "Right after a response arrives, urllib3 now turns every split header back into one line, in both copies of the headers.",
                "deep": "Normalize the source, then derive. The fix rewrites the <code>HTTPMessage</code> in place (same object, same order, same duplicates) and builds <code>HTTPHeaderDict</code> from the same normalized list. Both views are equal by construction, and nothing downstream has to know folding ever existed."
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:91-110"
                },
                {
                  "target": "diff:src-urllib3-connection.py:650-651"
                }
              ]
            },
            {
              "type": "table",
              "id": "b2",
              "html": "<table><tr><th>Raw value</th><th>After</th></tr><tr><td><code>before \\\\t\\\\r\\\\n\\\\t  after</code></td><td><code>before after</code></td></tr><tr><td><code>one\\\\r\\\\n two\\\\t\\\\r\\\\n\\\\tthree</code></td><td><code>one two three</code></td></tr><tr><td><code>one\\\\r\\\\n \\\\r\\\\n\\\\tthree</code></td><td><code>one  three</code> (two folds give two spaces)</td></tr><tr><td><code>ordinary\\\\tvalue</code></td><td>unchanged</td></tr></table>",
              "citations": []
            },
            {
              "type": "finding-link",
              "id": "b3",
              "pageId": "f-lf",
              "citations": []
            },
            {
              "type": "paragraph",
              "id": "b4",
              "text": {
                "standard": "The rule behind it: a parsed header value must never contain a line break. The pattern starts its optional whitespace match only at the beginning of a run of spaces, which keeps it <a class=\\"cx\\" data-link=\\"concept:regex-performance\\">linear-time</a> on long values, and a fast path skips any value without CRLF, which is almost all of them. ",
                "simple": "No header value should contain a line break after parsing. The code also stays fast, even for very long or unusual values.",
                "deep": "Two properties are enforced together: a semantic one (no CR or LF in values) and a performance one (cost linear in input). The second matters because response headers are attacker-controlled input; a pattern that backtracks quadratically would turn a cleanup step into a <a class=\\"cx\\" data-link=\\"concept:regex-performance\\">denial-of-service</a> vector."
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:80-88"
                }
              ]
            }
          ],
          "undoStack": []
        },
        {
          "id": "g-flow",
          "pageId": "root",
          "title": "Data flow: from the socket to HTTPHeaderDict",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "diagram",
              "id": "b1",
              "source": "direction: right\\nsock: \\"Server sends a folded header\\"\\nclient: \\"http.client parses into HTTPMessage\\" {link: \\"diff:conn:650-651\\"}\\nnorm: \\"_normalize_header_values\\"\\ndict: \\"HTTPHeaderDict r.headers\\"\\nmsg: \\"HTTPMessage same object\\" {link: \\"diff:tsock:139-146\\"}\\nsock -> client -> norm\\nnorm -> dict\\nnorm -> msg",
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:650-651"
                },
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:139-146"
                }
              ],
              "caption": "Where a response's headers go after parsing, and the one place they are now unfolded.",
              "render": {
                "hash": "f23beae236cc0685",
                "status": "ok"
              }
            },
            {
              "type": "list",
              "id": "b2",
              "ordered": true,
              "items": [
                {
                  "html": "<code>http.client</code> parses the response headers into an <code>HTTPMessage</code>. A folded value keeps its CRLF and leading whitespace.",
                  "citations": []
                },
                {
                  "html": "<code>getresponse()</code> passes that message to <code>_normalize_header_values</code> instead of reading <code>.items()</code> directly. ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:650"
                    }
                  ]
                },
                {
                  "html": "Each value goes through <code>_normalize_header_value</code>: values without CRLF return at once, folded ones are rewritten with the pattern. ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:85-88"
                    }
                  ]
                },
                {
                  "html": "If any value changed, the message is rewritten in place: every header is deleted, then the normalized list is added back in the same order. ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:102-108"
                    }
                  ]
                },
                {
                  "html": "<code>HTTPHeaderDict</code> is built from the same normalized list, so <code>r.headers</code> and <code>r._original_response.msg</code> agree.  ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:651"
                    },
                    {
                      "target": "diff:test-with_dummyserver-test_socketlevel.py:139-146"
                    }
                  ]
                }
              ],
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:650"
                },
                {
                  "target": "diff:src-urllib3-connection.py:85-88"
                },
                {
                  "target": "diff:src-urllib3-connection.py:102-108"
                },
                {
                  "target": "diff:src-urllib3-connection.py:651"
                },
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:139-146"
                }
              ]
            },
            {
              "type": "follow-up",
              "id": "b3",
              "items": [
                {
                  "label": "What happens to a fold that ends in a bare LF?",
                  "ask": "bare lf"
                },
                {
                  "label": "Does unfolding change header order?",
                  "ask": "order"
                }
              ],
              "citations": []
            }
          ],
          "undoStack": []
        },
        {
          "id": "g-design",
          "pageId": "root",
          "title": "Design: why the original HTTPMessage is rewritten too",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "A response's headers exist twice: urllib3's <code>HTTPHeaderDict</code> and <code>http.client</code>'s <code>HTTPMessage</code>. Requests reads cookies from the second, so cleaning only the first would leave the raw CRLF where it does harm. "
              },
              "citations": [
                {
                  "target": "desc:d-p2"
                }
              ]
            },
            {
              "type": "paragraph",
              "id": "b2",
              "text": {
                "standard": "The helper therefore rewrites the original message in place. It keeps the object's identity (the socket test checks <code>headers is msg</code>), its <code>defects</code> and <code>policy</code>, its payload, and the order of every header, including duplicate <code>Set-Cookie</code> lines.  "
              },
              "citations": [
                {
                  "target": "diff:test-test_connection.py:226-249"
                },
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:141"
                }
              ]
            },
            {
              "type": "paragraph",
              "id": "b3",
              "text": {
                "standard": "The alternative, building a new message, would break anything already holding a reference to the old one. Normalizing the list once and deriving both views from it makes them equal by construction."
              },
              "citations": []
            },
            {
              "type": "follow-up",
              "id": "b4",
              "items": [
                {
                  "label": "Is mutating the message in place safe?",
                  "ask": "identity"
                },
                {
                  "label": "What does this cost per response?",
                  "ask": "cost"
                }
              ],
              "citations": []
            }
          ],
          "undoStack": []
        },
        {
          "id": "g-regex",
          "pageId": "root",
          "title": "The pattern: why the lookbehind matters",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "<code>_OBSOLETE_FOLD_RE = (?:(?&lt;![ \\\\t])[ \\\\t]+)?\\\\r\\\\n[ \\\\t]+</code> "
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:82"
                }
              ]
            },
            {
              "type": "list",
              "id": "b2",
              "ordered": false,
              "items": [
                {
                  "html": "<code>(?:…)?</code>: optional whitespace before the line break, the <code>OWS</code> in <code>OWS CRLF RWS</code>.",
                  "citations": []
                },
                {
                  "html": "<code>(?&lt;![ \\\\t])</code>: that optional whitespace may only start where the previous character isn't a space or tab, i.e. at the start of a run. ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:80-81"
                    }
                  ]
                },
                {
                  "html": "<code>\\\\r\\\\n</code>: the line break itself.",
                  "citations": []
                },
                {
                  "html": "<code>[ \\\\t]+</code>: at least one space or tab starting the continuation line, the <code>RWS</code>.",
                  "citations": []
                }
              ],
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:80-81"
                }
              ]
            },
            {
              "type": "paragraph",
              "id": "b3",
              "text": {
                "standard": "Without the lookbehind, a long run of spaces that isn't followed by CRLF makes the engine try every start position and rescan the run each time, which is quadratic. With it, positions inside a run fail at once, so the scan is linear. "
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:80-81"
                }
              ]
            },
            {
              "type": "follow-up",
              "id": "b4",
              "items": [
                {
                  "label": "Why isn't this tested?",
                  "ask": "test"
                }
              ],
              "citations": []
            }
          ],
          "undoStack": []
        },
        {
          "id": "g-check",
          "pageId": "root",
          "title": "Review checklist",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "list",
              "id": "b1",
              "ordered": false,
              "items": [
                {
                  "html": "Unfolds exactly the RFC shape: optional whitespace, CRLF, at least one space or tab. ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:82"
                    }
                  ]
                },
                {
                  "html": "<a class=\\"cx\\" data-link=\\"page:f-lf\\">Folds that end in a bare LF are not unfolded</a>.  ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:82"
                    },
                    {
                      "target": "diff:src-urllib3-connection.py:86"
                    }
                  ]
                },
                {
                  "html": "Order and duplicate headers are preserved when the message is rewritten. ",
                  "citations": [
                    {
                      "target": "diff:test-test_connection.py:238-246"
                    }
                  ]
                },
                {
                  "html": "The original message keeps its identity, payload, defects and policy.  ",
                  "citations": [
                    {
                      "target": "diff:test-test_connection.py:247-249"
                    },
                    {
                      "target": "diff:test-with_dummyserver-test_socketlevel.py:141"
                    }
                  ]
                },
                {
                  "html": "<a class=\\"cx\\" data-link=\\"page:f-perf\\">The linear-time claim has no test</a>. ",
                  "citations": [
                    {
                      "target": "diff:src-urllib3-connection.py:80-82"
                    }
                  ]
                },
                {
                  "html": "Tabs inside ordinary values are left alone.  ",
                  "citations": [
                    {
                      "target": "diff:test-test_connection.py:217"
                    },
                    {
                      "target": "diff:test-with_dummyserver-test_socketlevel.py:133"
                    }
                  ]
                },
                {
                  "html": "Two adjacent folds give two spaces, which RFC 9112 allows. ",
                  "citations": [
                    {
                      "target": "diff:test-test_connection.py:220"
                    }
                  ]
                }
              ],
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:82"
                },
                {
                  "target": "diff:src-urllib3-connection.py:86"
                },
                {
                  "target": "diff:test-test_connection.py:238-246"
                },
                {
                  "target": "diff:test-test_connection.py:247-249"
                },
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:141"
                },
                {
                  "target": "diff:src-urllib3-connection.py:80-82"
                },
                {
                  "target": "diff:test-test_connection.py:217"
                },
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:133"
                },
                {
                  "target": "diff:test-test_connection.py:220"
                }
              ]
            },
            {
              "type": "follow-up",
              "id": "b2",
              "items": [
                {
                  "label": "Is the double space intended?",
                  "ask": "two spaces"
                }
              ],
              "citations": []
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "f-lf",
      "kind": "finding",
      "title": "Folds that end in a bare LF are not unfolded",
      "saved": false,
      "parent": "root",
      "confidence": "medium",
      "summary": "http.client accepts header lines ending in LF alone, but the new code only looks for CRLF.",
      "cards": [
        {
          "id": "flf-ev",
          "pageId": "f-lf",
          "title": "Evidence",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "Code: the fast path returns early unless the value contains <code>&quot;\\\\r\\\\n&quot;</code>, and the pattern requires <code>\\\\r\\\\n</code>.  "
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:86-88"
                },
                {
                  "target": "diff:src-urllib3-connection.py:82"
                }
              ]
            },
            {
              "type": "paragraph",
              "id": "b2",
              "text": {
                "standard": "Parser: <code>http.client</code> accepts header lines ending in a bare LF. Checked locally: parsing <code>Set-Cookie: a=1\\\\n b=2</code> returns the value <code>'a=1\\\\n b=2'</code>, which these helpers leave unchanged."
              },
              "citations": []
            },
            {
              "type": "paragraph",
              "id": "b3",
              "text": {
                "standard": "Tests: every fold in the socket test and the unit tests uses CRLF.  "
              },
              "citations": [
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:99-118"
                },
                {
                  "target": "diff:test-test_connection.py:214-222"
                }
              ]
            }
          ],
          "undoStack": []
        },
        {
          "id": "flf-as",
          "pageId": "f-lf",
          "title": "Assessment",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "The invariant the PR states, no raw line breaks in header values, still fails for a folded value whose lines end in a bare LF. That's the same <a class=\\"cx\\" data-link=\\"concept:header-injection\\">header injection</a> risk through LF instead of CRLF. RFC 9112 lets recipients accept a bare LF as a line terminator, and <code>http.client</code> does. Broadening the pattern and fast path to <code>\\\\r?\\\\n</code>, plus one test, would close it. Confidence is medium: the maintainers may have left LF out deliberately, and it depends on <code>http.client</code>'s behaviour.",
                "simple": "A rarer kind of split header, using only LF, still keeps its line break. A small change to the pattern would cover it.",
                "deep": "A sanitizer is only as strong as its coverage of the parser it follows: whatever line terminators the parser accepts, the sanitizer must also recognize. Here the parser is more permissive (CRLF or LF) than the sanitizer (CRLF only), so there's a gap between &quot;accepted&quot; and &quot;cleaned&quot;."
              },
              "citations": []
            },
            {
              "type": "follow-up",
              "id": "b2",
              "items": [
                {
                  "label": "Would rejecting folds be safer than unfolding?",
                  "ask": "rfc"
                }
              ],
              "citations": []
            },
            {
              "type": "comment-link",
              "id": "b-comment",
              "diffRef": "diff:src-urllib3-connection.py:82",
              "threadId": "t-sglf",
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:82"
                }
              ]
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "f-perf",
      "kind": "finding",
      "title": "The linear-time claim has no test",
      "saved": false,
      "parent": "root",
      "confidence": "high",
      "summary": "The description and a comment rely on the pattern being linear-time, but nothing would catch a regression.",
      "cards": [
        {
          "id": "fpf-ev",
          "pageId": "f-perf",
          "title": "Evidence",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "Description: it says the normalization uses a linear-time pattern for long field values. "
              },
              "citations": [
                {
                  "target": "desc:d-p2"
                }
              ]
            },
            {
              "type": "paragraph",
              "id": "b2",
              "text": {
                "standard": "Code: a comment explains that starting the whitespace match at the beginning of a run avoids quadratic backtracking. "
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:80-82"
                }
              ]
            },
            {
              "type": "paragraph",
              "id": "b3",
              "text": {
                "standard": "Tests: no test uses a long value or a long run of spaces. "
              },
              "citations": [
                {
                  "target": "diff:test-test_connection.py:214-222"
                }
              ]
            }
          ],
          "undoStack": []
        },
        {
          "id": "fpf-as",
          "pageId": "f-perf",
          "title": "Assessment",
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "The pattern is correct today, but the property that makes it safe (the lookbehind) is easy to &quot;simplify&quot; away later, and response headers are untrusted input. A test that normalizes a value with a very long run of spaces, kept within a generous time limit, would protect it. This is a test gap, not a bug."
              },
              "citations": []
            },
            {
              "type": "comment-link",
              "id": "b-comment",
              "diffRef": "diff:src-urllib3-connection.py:80",
              "threadId": "t-sgperf",
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:80"
                }
              ]
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "c-obs-fold",
      "kind": "concept",
      "title": "Obsolete line folding (obs-fold)",
      "saved": true,
      "parent": "root",
      "cards": [
        {
          "id": "cc-obs-fold",
          "pageId": "c-obs-fold",
          "title": null,
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "HTTP/1.1 originally let a server continue a header value on the next line, as long as that line started with a space or tab. That's line folding. RFC 9112 now calls it <code>obs-fold</code> (obsolete folding): servers must not send it, and a client that receives it must replace each fold with one or more spaces before using the value. Python's <code>http.client</code> doesn't do that; it keeps the CRLF and the leading whitespace inside the value.  ",
                "simple": "Some servers split one long header across two lines, starting the second line with spaces. The modern rule is: treat that split as a single space. Python keeps the line break instead, so urllib3 has to clean it up.",
                "deep": "A fold is a property of the encoding, not of the value: the same value can be sent folded or not. A parser that keeps the fold leaks its input format into the semantic value, so every consumer must either re-implement unfolding or carry a raw line break further. RFC 9112 section 5.2 resolves it at the recipient, before interpretation or forwarding."
              },
              "citations": [
                {
                  "target": "desc:d-p1"
                },
                {
                  "target": "diff:src-urllib3-connection.py:80-82"
                }
              ]
            },
            {
              "type": "aside",
              "id": "b2",
              "kind": "Example",
              "inner": [
                {
                  "type": "code",
                  "id": "b2-b1",
                  "code": "Set-Cookie: a=1; path=/ <CR><LF>\\n    Max-Age=900<CR><LF>\\n\\n# http.client keeps:   'a=1; path=/ \\\\r\\\\n    Max-Age=900'\\n# urllib3 now returns: 'a=1; path=/ Max-Age=900'",
                  "citations": []
                }
              ],
              "citations": []
            },
            {
              "type": "paragraph",
              "id": "b3",
              "text": {
                "standard": "RFC 9112 allows a recipient to reject a folded message or unfold it. urllib3 unfolds, using one space per fold. Whitespace is one of the <a class=\\"cx\\" data-link=\\"concept:ows-rws\\">OWS and RWS</a> rules."
              },
              "citations": []
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "c-http-headers",
      "kind": "concept",
      "title": "HTTPHeaderDict and HTTPMessage",
      "saved": true,
      "parent": "root",
      "cards": [
        {
          "id": "cc-http-headers",
          "pageId": "c-http-headers",
          "title": null,
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "A urllib3 response carries its headers twice. <code>r.headers</code> is urllib3's <code>HTTPHeaderDict</code>, a case-insensitive dict that keeps repeated headers. <code>r._original_response.msg</code> is the <code>HTTPMessage</code> that <code>http.client</code> built while parsing, based on Python's email message class. urllib3 builds the first from the second, but some libraries, notably Requests for cookies, read the second directly. Fixing only one would leave them disagreeing. ",
                "simple": "There are two copies of the headers: urllib3's own, and the one Python's HTTP library made. Other libraries read different copies, so both need the same clean values.",
                "deep": "Two representations of one fact are a consistency hazard. The PR chooses to normalize the source, then derive: it rewrites the <code>HTTPMessage</code> in place (keeping the object's identity, defects and policy) and builds <code>HTTPHeaderDict</code> from the same normalized list, so both views are equal by construction."
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:650-651"
                }
              ]
            },
            {
              "type": "aside",
              "id": "b2",
              "kind": "Example",
              "inner": [
                {
                  "type": "code",
                  "id": "b2-b1",
                  "code": "r = pool.request(\\"GET\\", \\"/\\")\\nr.headers.getlist(\\"set-cookie\\")                # urllib3's HTTPHeaderDict\\nr._original_response.msg.get_all(\\"set-cookie\\") # http.client's HTTPMessage\\n# Requests' cookie jar reads the second one.",
                  "citations": []
                }
              ],
              "citations": []
            },
            {
              "type": "paragraph",
              "id": "b3",
              "text": {
                "standard": "Repeated headers matter here, especially <a class=\\"cx\\" data-link=\\"concept:set-cookie\\">Set-Cookie</a>, which can't be joined into one value."
              },
              "citations": []
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "c-header-injection",
      "kind": "concept",
      "title": "Header injection through raw line breaks",
      "saved": true,
      "parent": "root",
      "cards": [
        {
          "id": "cc-header-injection",
          "pageId": "c-header-injection",
          "title": null,
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "HTTP separates headers with CRLF. If a header value itself contains CRLF and some code later writes that value back out, for example a cookie jar sending a stored cookie on the next request, the line break ends the header early and whatever follows becomes a new header. That's header injection. Here the risk is that a folded <code>Set-Cookie</code> could be re-sent with a raw CRLF inside it. ",
                "simple": "A hidden line break inside a header can split one header into two when the value is sent again. Removing line breaks from values prevents that.",
                "deep": "The invariant is simple: no CR or LF in a field value after parsing. Code that serializes headers trusts that invariant, so it must hold at the boundary where external bytes become values. Enforcing it once in <code>getresponse()</code> protects every downstream serializer, as long as the enforcement covers every line terminator the parser accepts."
              },
              "citations": [
                {
                  "target": "desc:d-p2"
                }
              ]
            },
            {
              "type": "aside",
              "id": "b2",
              "kind": "Example",
              "inner": [
                {
                  "type": "code",
                  "id": "b2-b1",
                  "code": "# stored cookie value with a raw fold:\\n\\"session=abc \\\\r\\\\n X-Injected: 1\\"\\n# re-sent as a request header:\\nCookie: session=abc\\n X-Injected: 1        <- a server may read this as a new header",
                  "citations": []
                }
              ],
              "citations": []
            },
            {
              "type": "paragraph",
              "id": "b3",
              "text": {
                "standard": "Requests is one such consumer: it reads cookies from <a class=\\"cx\\" data-link=\\"concept:requests-cookies\\">the original message</a>."
              },
              "citations": []
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "c-regex-performance",
      "kind": "concept",
      "title": "Regex backtracking and linear-time patterns",
      "saved": true,
      "parent": "root",
      "cards": [
        {
          "id": "cc-regex-performance",
          "pageId": "c-regex-performance",
          "title": null,
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "The pattern is <code>(?:(?&lt;![ \\\\t])[ \\\\t]+)?\\\\r\\\\n[ \\\\t]+</code>: optional spaces or tabs, then CRLF, then at least one space or tab. The <code>(?&lt;![ \\\\t])</code> lookbehind lets the optional whitespace match start only at the beginning of a run of spaces. Without it, a long run of spaces that isn't followed by CRLF makes the engine try every starting position and rescan the whole run from each one, which takes quadratic time. ",
                "simple": "The pattern finds &quot;spaces, line break, spaces&quot;. A small extra check stops it re-reading the same spaces over and over, so very long header values can't make it slow.",
                "deep": "Regex engines that backtrack retry at each start position. With <code>[ \\\\t]*\\\\r\\\\n</code>, a run of n spaces costs n - i steps from position i, which is O(n^2) in total. The lookbehind fails in O(1) everywhere inside a run, so only the run's first character starts the expensive scan, which brings the total to O(n). It's the same idea as anchoring a token to its leftmost position."
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:80-82"
                }
              ]
            },
            {
              "type": "aside",
              "id": "b2",
              "kind": "Example",
              "inner": [
                {
                  "type": "code",
                  "id": "b2-b1",
                  "code": "value = \\" \\" * 100_000 + \\"x\\"\\nre.sub(r\\"[ \\\\t]*\\\\r\\\\n[ \\\\t]+\\", \\" \\", value)               # O(n^2): slow\\nre.sub(r\\"(?:(?<![ \\\\t])[ \\\\t]+)?\\\\r\\\\n[ \\\\t]+\\", \\" \\", value) # O(n)",
                  "citations": []
                }
              ],
              "citations": []
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "c-ows-rws",
      "kind": "concept",
      "title": "OWS and RWS: whitespace in HTTP",
      "saved": true,
      "parent": "root",
      "cards": [
        {
          "id": "cc-ows-rws",
          "pageId": "c-ows-rws",
          "title": null,
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "HTTP's grammar names its whitespace. <code>OWS</code> is optional whitespace (zero or more spaces or tabs) and <code>RWS</code> is required whitespace (at least one). A fold is <code>OWS CRLF RWS</code>: maybe some spaces, the line break, then at least one space or tab starting the next line. That's exactly the shape of the PR's regex. ",
                "simple": "&quot;Optional spaces, a line break, then at least one space&quot;: that's what a fold looks like, and that's what the code searches for."
              },
              "citations": [
                {
                  "target": "diff:src-urllib3-connection.py:82"
                }
              ]
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "c-set-cookie",
      "kind": "concept",
      "title": "Why Set-Cookie lines stay separate",
      "saved": true,
      "parent": "root",
      "cards": [
        {
          "id": "cc-set-cookie",
          "pageId": "c-set-cookie",
          "title": null,
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "<code>Set-Cookie</code> is the one header that can't be combined into a comma-separated list, because cookie attributes such as <code>Expires=Wed, 21 Oct 2026 …</code> contain commas themselves. urllib3's <code>HTTPHeaderDict</code> still keeps each <code>Set-Cookie</code> line separately (<code>getlist</code>), and the PR has to preserve that, along with the order of duplicate headers, when it rewrites the message. ",
                "simple": "Each cookie has to stay as its own header line, because cookies contain commas. The fix keeps every cookie separate and in order.",
                "deep": "Set-Cookie breaks the general rule that repeated fields are equivalent to one comma-joined field (RFC 9110 section 5.3 calls this out explicitly). Any header normalization therefore has to work on the list of (name, value) pairs, never on a joined map, which is why the helper takes <code>message.items()</code> and writes them back in order."
              },
              "citations": [
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:124-127"
                }
              ]
            },
            {
              "type": "aside",
              "id": "b2",
              "kind": "Example",
              "inner": [
                {
                  "type": "code",
                  "id": "b2-b1",
                  "code": "r.headers[\\"set-cookie\\"]         # 'foo=1, bar=1'   (joined: lossy)\\nr.headers.getlist(\\"set-cookie\\") # ['foo=1', 'bar=1'] (kept apart)",
                  "citations": []
                }
              ],
              "citations": []
            }
          ],
          "undoStack": []
        }
      ]
    },
    {
      "id": "c-requests-cookies",
      "kind": "concept",
      "title": "Requests reads the original HTTPMessage",
      "saved": true,
      "parent": "root",
      "cards": [
        {
          "id": "cc-requests-cookies",
          "pageId": "c-requests-cookies",
          "title": null,
          "level": "standard",
          "read": false,
          "collapsed": false,
          "revision": 1,
          "blocks": [
            {
              "type": "paragraph",
              "id": "b1",
              "text": {
                "standard": "Requests builds its cookie jar from <code>response._original_response.msg</code>, the <code>http.client</code> message, not from urllib3's <code>r.headers</code>. That's why the PR rewrites the original message in place instead of only cleaning the dict it builds. The socket-level test checks both views and that the message is still the same object. ",
                "simple": "Requests reads cookies from Python's own copy of the headers, so that copy has to be fixed too, not just urllib3's."
              },
              "citations": [
                {
                  "target": "diff:test-with_dummyserver-test_socketlevel.py:139-146"
                }
              ]
            }
          ],
          "undoStack": []
        }
      ]
    }
  ],
  "annotations": [
    {
      "id": "x-seed",
      "type": "expansion",
      "anchor": {
        "host": {
          "kind": "block",
          "blockId": "problem#b1"
        },
        "quotedText": "raw CRLF",
        "prefix": "value as it arrived, with the",
        "suffix": "inside it, and urllib3 copied",
        "position": 0,
        "version": 1
      },
      "open": true,
      "messages": [],
      "post": false,
      "note": false,
      "expansion": {
        "blocks": [
          {
            "type": "paragraph",
            "id": "b1",
            "text": {
              "standard": "HTTP/1.1 originally let a server continue a header value on the next line, as long as that line started with a space or tab. That's line folding. RFC 9112 now calls it <code>obs-fold</code> (obsolete folding): servers must not send it, and a client that receives it must replace each fold with one or more spaces before using the value. Python's <code>http.client</code> doesn't do that; it keeps the CRLF and the leading whitespace inside the value.  ",
              "simple": "Some servers split one long header across two lines, starting the second line with spaces. The modern rule is: treat that split as a single space. Python keeps the line break instead, so urllib3 has to clean it up.",
              "deep": "A fold is a property of the encoding, not of the value: the same value can be sent folded or not. A parser that keeps the fold leaks its input format into the semantic value, so every consumer must either re-implement unfolding or carry a raw line break further. RFC 9112 section 5.2 resolves it at the recipient, before interpretation or forwarding."
            },
            "citations": [
              {
                "target": "desc:d-p1"
              },
              {
                "target": "diff:src-urllib3-connection.py:80-82"
              }
            ]
          },
          {
            "type": "aside",
            "id": "b2",
            "kind": "Example",
            "inner": [
              {
                "type": "code",
                "id": "b2-b1",
                "code": "Set-Cookie: a=1; path=/ <CR><LF>\\n    Max-Age=900<CR><LF>\\n\\n# http.client keeps:   'a=1; path=/ \\\\r\\\\n    Max-Age=900'\\n# urllib3 now returns: 'a=1; path=/ Max-Age=900'",
                "citations": []
              }
            ],
            "citations": []
          }
        ],
        "level": "standard",
        "read": false,
        "collapsed": false,
        "revision": 1,
        "undoStack": []
      }
    },
    {
      "id": "t-seed",
      "type": "thread",
      "anchor": {
        "host": {
          "kind": "block",
          "blockId": "central#b4"
        },
        "quotedText": "fast path",
        "prefix": "them.",
        "suffix": ", which is almost all",
        "position": 0,
        "version": 1
      },
      "open": true,
      "messages": [
        {
          "who": "you",
          "text": "Does the fast path still catch a fold that uses a bare LF?"
        },
        {
          "who": "ai",
          "html": "Not with this PR. The fast path checks for <code>\\"\\\\r\\\\n\\"</code> and the pattern requires <code>\\\\r\\\\n</code>. <code>http.client</code> also accepts header lines that end in a bare LF. The tests only send CRLF folds. See the finding about bare LF folds."
        }
      ],
      "post": false,
      "note": false
    },
    {
      "id": "t-sglf",
      "type": "thread",
      "anchor": {
        "host": {
          "kind": "diff-line",
          "fileKey": "src-urllib3-connection.py",
          "line": 82
        },
        "quotedText": "_OBSOLETE_FOLD_RE",
        "prefix": "",
        "suffix": "",
        "position": 0,
        "version": 1
      },
      "open": true,
      "messages": [
        {
          "who": "ai",
          "suggested": true,
          "text": "http.client also accepts header lines that end in a bare LF, so a fold like \`a=1\\\\n b=2\` keeps its line break: both the \`\\"\\\\r\\\\n\\" not in value\` fast path and this pattern only look for CRLF. Would \`\\\\r?\\\\n\` here (and in the fast path), plus a test, make sense?"
        }
      ],
      "post": false,
      "note": false
    },
    {
      "id": "t-sgperf",
      "type": "thread",
      "anchor": {
        "host": {
          "kind": "diff-line",
          "fileKey": "src-urllib3-connection.py",
          "line": 80
        },
        "quotedText": "Starting the optional OWS match",
        "prefix": "",
        "suffix": "",
        "position": 0,
        "version": 1
      },
      "open": true,
      "messages": [
        {
          "who": "ai",
          "suggested": true,
          "text": "Could we add a test that normalizes a value with a very long run of spaces, so a later simplification of this pattern can't bring back the quadratic case?"
        }
      ],
      "post": false,
      "note": false
    },
    {
      "id": "t-diff",
      "type": "thread",
      "anchor": {
        "host": {
          "kind": "diff-line",
          "fileKey": "test-test_connection.py",
          "line": 220
        },
        "quotedText": "one  three",
        "prefix": "",
        "suffix": "",
        "position": 0,
        "version": 1
      },
      "open": true,
      "messages": [
        {
          "who": "you",
          "text": "Is the double space here intended?"
        },
        {
          "who": "ai",
          "html": "Yes. RFC 9112 allows replacing each fold with <em>one or more</em> spaces, and the helper replaces each fold with exactly one. <code>\\"one\\\\r\\\\n \\\\r\\\\n\\\\tthree\\"</code> contains two folds back to back, so it becomes two spaces. Collapsing them further would change whitespace the server actually sent."
        }
      ],
      "post": false,
      "note": false
    }
  ],
  "hunkStates": [
    {
      "contentHash": "fa60105d7fcbe8fe",
      "folded": false,
      "reviewed": false
    },
    {
      "contentHash": "b355d2096d4d7f39",
      "folded": false,
      "reviewed": false,
      "note": "Only call site; everything else is the helper."
    },
    {
      "contentHash": "6cfb09ec98cba6ba",
      "folded": false,
      "reviewed": false
    },
    {
      "contentHash": "92cf4ca541bdb0f2",
      "folded": false,
      "reviewed": false
    },
    {
      "contentHash": "b33779988cee5f8a",
      "folded": true,
      "reviewed": true
    },
    {
      "contentHash": "29382503b8689e5f",
      "folded": false,
      "reviewed": false
    },
    {
      "contentHash": "949dda852e448b55",
      "folded": false,
      "reviewed": false
    },
    {
      "contentHash": "d1c6f159e5ffb42d",
      "folded": false,
      "reviewed": false
    }
  ],
  "jobs": [
    {
      "id": "job-reader",
      "kind": "reader",
      "model": "fixture",
      "priority": 1,
      "state": "done"
    },
    {
      "id": "job-critic-lf",
      "kind": "critic",
      "model": "fixture",
      "priority": 2,
      "state": "done"
    },
    {
      "id": "job-critic-perf",
      "kind": "critic",
      "model": "fixture",
      "priority": 2,
      "state": "done"
    },
    {
      "id": "job-hunk-pass",
      "kind": "hunk-pass",
      "model": "fixture",
      "priority": 3,
      "state": "done"
    }
  ],
  "contributions": [],
  "logTail": [],
  "rev": 1
}
`,sc=JSON.parse(e0);function ic(e){return JSON.parse(JSON.stringify(e))}const oh=ic(sc.pages),n0=ic(sc.annotations),t0=ic(sc.description??{html:"",rev:"",source:"pr",editable:!1});class Bi extends Error{constructor(t,r){super(`diagram ${t}${r?`: ${r}`:""}`);oo(this,"status");oo(this,"detail");this.name="DiagramStatusError",this.status=t,this.detail=r}}const r0=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-d2-version="v0.9.0" preserveAspectRatio="xMinYMin meet" viewBox="0 0 1379 251"><svg class="d2-934584957 d2-svg" width="1379" height="251" viewBox="-21 -38 1379 251"><rect x="-21" y="-38" width="1379" height="251" rx="0" fill="#FFFFFF" class=" fill-N7" stroke-width="0"/><style><![CDATA[
.appendix-icon {
	filter: drop-shadow(0px 0px 32px rgba(31, 36, 58, 0.1));
}
.d2-934584957 .text-bold {
	font-family: "d2-934584957-font-bold";
}
@font-face {
	font-family: d2-934584957-font-bold;
	src: url("data:application/font-woff;base64,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");
}]]></style><style><![CDATA[.shape {
  shape-rendering: geometricPrecision;
  stroke-linejoin: round;
}
.connection {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.blend {
  mix-blend-mode: multiply;
  opacity: 0.5;
}

		.d2-934584957 .fill-N1{fill:#0A0F25;}
		.d2-934584957 .fill-N7{fill:#FFFFFF;}
		.d2-934584957 .fill-B1{fill:#0D32B2;}
		.d2-934584957 .fill-B6{fill:#F7F8FE;}
		.d2-934584957 .stroke-B1{stroke:#0D32B2;}
		.d2-934584957 .stroke-B2{stroke:#0D32B2;}.appendix text.text{fill:#0A0F25}.md{--color-fg-default:#0A0F25;--color-fg-muted:#676C7E;--color-fg-subtle:#9499AB;--color-canvas-default:#FFFFFF;--color-canvas-subtle:#EEF1F8;--color-border-default:#0D32B2;--color-border-muted:#0D32B2;--color-neutral-muted:#EEF1F8;--color-accent-fg:#0D32B2;--color-accent-emphasis:#0D32B2;--color-attention-subtle:#676C7E;--color-danger-fg:red;}.light-code{display: block}.dark-code{display: none}]]></style><g class="c29jaw=="><g class="shape"><rect x="0" y="63" width="250" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="125" y="101.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">Server sends a folded header</text></g><a href="#" data-refs="diff:src-urllib3-connection.py:650-651" data-src="diff:src-urllib3-connection.py:650-651"><g class="Y2xpZW50"><g class="shape"><rect x="350" y="63" width="302" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="501" y="101.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">http.client parses into HTTPMessage</text></g></a><g class="bm9ybQ=="><g class="shape"><rect x="752" y="63" width="236" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="870" y="101.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">_normalize_header_values</text></g><g class="ZGljdA=="><g class="shape"><rect x="1088" y="126" width="233" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1204.5" y="164.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPHeaderDict r.headers</text></g><a href="#" data-refs="diff:test-with_dummyserver-test_socketlevel.py:139-146" data-src="diff:test-with_dummyserver-test_socketlevel.py:139-146"><g class="bXNn"><g class="shape"><rect x="1089" y="0" width="231" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1204.5" y="38.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPMessage same object</text></g></a><g class="KHNvY2sgLSZndDsgY2xpZW50KVswXQ=="><marker id="d2-f23beae236cc0685-mk-d2-934584957-3488378134" markerWidth="10" markerHeight="12" refX="7" refY="6" viewBox="0 0 10 12" orient="auto" markerUnits="userSpaceOnUse"> <polygon points="0,0 10,6 0,12" fill="#0D32B2" class="connection fill-B1" stroke-width="2"/> </marker><path d="M 252 96 C 290 96 310 96 346 96" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-934584957-3488378134)" mask="url(#d2-f23beae236cc0685-d2-934584957)"/></g><g class="KGNsaWVudCAtJmd0OyBub3JtKVswXQ=="><path d="M 654 96 C 692 96 712 96 748 96" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-934584957-3488378134)" mask="url(#d2-f23beae236cc0685-d2-934584957)"/></g><g class="KG5vcm0gLSZndDsgZGljdClbMF0="><path d="M 959.872658 129.702247 C 1022 153 1048 159 1084 159" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-934584957-3488378134)" mask="url(#d2-f23beae236cc0685-d2-934584957)"/></g><g class="KG5vcm0gLSZndDsgbXNnKVswXQ=="><path d="M 959.872658 62.297753 C 1022 39 1048.199951 33 1085 33" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-934584957-3488378134)" mask="url(#d2-f23beae236cc0685-d2-934584957)"/></g><g transform="translate(636 47)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-f23beae236cc0685-clip0_3440_35088111-d2-934584957-MNWGSZLOOQ)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-f23beae236cc0685-clip0_3440_35088111-d2-934584957-MNWGSZLOOQ">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(1304 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-f23beae236cc0685-clip0_3440_35088111-d2-934584957-NVZWO)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-f23beae236cc0685-clip0_3440_35088111-d2-934584957-NVZWO">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><mask id="d2-f23beae236cc0685-d2-934584957" x="-21" y="-38" width="1379" height="251">
<rect x="-21" y="-38" width="1379" height="251" fill="white"></rect>

</mask></svg></svg>
`,s0=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-d2-version="v0.9.0" preserveAspectRatio="xMinYMin meet" viewBox="0 0 1379 251"><svg class="d2-153167135 d2-svg" width="1379" height="251" viewBox="-21 -38 1379 251"><rect x="-21" y="-38" width="1379" height="251" rx="0" fill="#1E1E2E" class=" fill-N7" stroke-width="0"/><style><![CDATA[
.appendix-icon {
	filter: drop-shadow(0px 0px 32px rgba(31, 36, 58, 0.1));
}
.d2-153167135 .text-bold {
	font-family: "d2-153167135-font-bold";
}
@font-face {
	font-family: d2-153167135-font-bold;
	src: url("data:application/font-woff;base64,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");
}]]></style><style><![CDATA[.shape {
  shape-rendering: geometricPrecision;
  stroke-linejoin: round;
}
.connection {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.blend {
  mix-blend-mode: multiply;
  opacity: 0.5;
}

		.d2-153167135 .fill-N1{fill:#CDD6F4;}
		.d2-153167135 .fill-N7{fill:#1E1E2E;}
		.d2-153167135 .fill-B1{fill:#CBA6f7;}
		.d2-153167135 .fill-B6{fill:#313244;}
		.d2-153167135 .stroke-B1{stroke:#CBA6f7;}
		.d2-153167135 .stroke-B2{stroke:#CBA6f7;}.appendix text.text{fill:#CDD6F4}.md{--color-fg-default:#CDD6F4;--color-fg-muted:#BAC2DE;--color-fg-subtle:#A6ADC8;--color-canvas-default:#1E1E2E;--color-canvas-subtle:#313244;--color-border-default:#CBA6f7;--color-border-muted:#CBA6f7;--color-neutral-muted:#313244;--color-accent-fg:#CBA6f7;--color-accent-emphasis:#CBA6f7;--color-attention-subtle:#BAC2DE;--color-danger-fg:red;}.light-code{display: none}.dark-code{display: block}]]></style><g class="c29jaw=="><g class="shape"><rect x="0" y="63" width="250" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="125" y="101.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">Server sends a folded header</text></g><a href="#" data-refs="diff:src-urllib3-connection.py:650-651" data-src="diff:src-urllib3-connection.py:650-651"><g class="Y2xpZW50"><g class="shape"><rect x="350" y="63" width="302" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="501" y="101.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">http.client parses into HTTPMessage</text></g></a><g class="bm9ybQ=="><g class="shape"><rect x="752" y="63" width="236" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="870" y="101.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">_normalize_header_values</text></g><g class="ZGljdA=="><g class="shape"><rect x="1088" y="126" width="233" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1204.5" y="164.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPHeaderDict r.headers</text></g><a href="#" data-refs="diff:test-with_dummyserver-test_socketlevel.py:139-146" data-src="diff:test-with_dummyserver-test_socketlevel.py:139-146"><g class="bXNn"><g class="shape"><rect x="1089" y="0" width="231" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1204.5" y="38.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPMessage same object</text></g></a><g class="KHNvY2sgLSZndDsgY2xpZW50KVswXQ=="><marker id="d2-f23beae236cc0685-mk-d2-153167135-3488378134" markerWidth="10" markerHeight="12" refX="7" refY="6" viewBox="0 0 10 12" orient="auto" markerUnits="userSpaceOnUse"> <polygon points="0,0 10,6 0,12" fill="#CBA6f7" class="connection fill-B1" stroke-width="2"/> </marker><path d="M 252 96 C 290 96 310 96 346 96" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-153167135-3488378134)" mask="url(#d2-f23beae236cc0685-d2-153167135)"/></g><g class="KGNsaWVudCAtJmd0OyBub3JtKVswXQ=="><path d="M 654 96 C 692 96 712 96 748 96" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-153167135-3488378134)" mask="url(#d2-f23beae236cc0685-d2-153167135)"/></g><g class="KG5vcm0gLSZndDsgZGljdClbMF0="><path d="M 959.872658 129.702247 C 1022 153 1048 159 1084 159" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-153167135-3488378134)" mask="url(#d2-f23beae236cc0685-d2-153167135)"/></g><g class="KG5vcm0gLSZndDsgbXNnKVswXQ=="><path d="M 959.872658 62.297753 C 1022 39 1048.199951 33 1085 33" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-f23beae236cc0685-mk-d2-153167135-3488378134)" mask="url(#d2-f23beae236cc0685-d2-153167135)"/></g><g transform="translate(636 47)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-f23beae236cc0685-clip0_3440_35088111-d2-153167135-MNWGSZLOOQ)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-f23beae236cc0685-clip0_3440_35088111-d2-153167135-MNWGSZLOOQ">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(1304 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-f23beae236cc0685-clip0_3440_35088111-d2-153167135-NVZWO)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-f23beae236cc0685-clip0_3440_35088111-d2-153167135-NVZWO">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><mask id="d2-f23beae236cc0685-d2-153167135" x="-21" y="-38" width="1379" height="251">
<rect x="-21" y="-38" width="1379" height="251" fill="white"></rect>

</mask></svg></svg>
`,i0=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-d2-version="v0.9.0" preserveAspectRatio="xMinYMin meet" viewBox="0 0 1867 251"><svg class="d2-2921080108 d2-svg" width="1867" height="251" viewBox="-21 -38 1867 251"><rect x="-21" y="-38" width="1867" height="251" rx="0" fill="#FFFFFF" class=" fill-N7" stroke-width="0"/><style><![CDATA[
.appendix-icon {
	filter: drop-shadow(0px 0px 32px rgba(31, 36, 58, 0.1));
}
.d2-2921080108 .text-bold {
	font-family: "d2-2921080108-font-bold";
}
@font-face {
	font-family: d2-2921080108-font-bold;
	src: url("data:application/font-woff;base64,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");
}
.d2-2921080108 .text-italic {
	font-family: "d2-2921080108-font-italic";
}
@font-face {
	font-family: d2-2921080108-font-italic;
	src: url("data:application/font-woff;base64,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");
}]]></style><style><![CDATA[.shape {
  shape-rendering: geometricPrecision;
  stroke-linejoin: round;
}
.connection {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.blend {
  mix-blend-mode: multiply;
  opacity: 0.5;
}

		.d2-2921080108 .fill-N1{fill:#0A0F25;}
		.d2-2921080108 .fill-N2{fill:#676C7E;}
		.d2-2921080108 .fill-N7{fill:#FFFFFF;}
		.d2-2921080108 .fill-B1{fill:#0D32B2;}
		.d2-2921080108 .fill-B6{fill:#F7F8FE;}
		.d2-2921080108 .stroke-B1{stroke:#0D32B2;}
		.d2-2921080108 .stroke-B2{stroke:#0D32B2;}.appendix text.text{fill:#0A0F25}.md{--color-fg-default:#0A0F25;--color-fg-muted:#676C7E;--color-fg-subtle:#9499AB;--color-canvas-default:#FFFFFF;--color-canvas-subtle:#EEF1F8;--color-border-default:#0D32B2;--color-border-muted:#0D32B2;--color-neutral-muted:#EEF1F8;--color-accent-fg:#0D32B2;--color-accent-emphasis:#0D32B2;--color-attention-subtle:#676C7E;--color-danger-fg:red;}.light-code{display: block}.dark-code{display: none}]]></style><g class="c2VydmVy"><g class="shape"><rect x="0" y="63" width="194" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="97" y="101.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">Server folded header</text></g><g class="Y2xpZW50"><g class="shape"><rect x="332" y="63" width="227" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="445.5" y="101.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">http.client parse_headers</text></g><g class="bXNn"><g class="shape"><rect x="697" y="63" width="268" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="831" y="101.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPMessage value keeps CRLF</text></g><a href="#" data-refs="diff:src-urllib3-connection.py:91-110" data-src="diff:src-urllib3-connection.py:91-110"><g class="bm9ybQ=="><g class="shape"><rect x="1103" y="63" width="236" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1221" y="101.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">_normalize_header_values</text></g></a><a href="#" data-refs="diff:src-urllib3-connection.py:650-651" data-src="diff:src-urllib3-connection.py:650-651"><g class="ZGljdA=="><g class="shape"><rect x="1575" y="126" width="233" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1691.5" y="164.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPHeaderDict r.headers</text></g></a><a href="#" data-refs="diff:test-with_dummyserver-test_socketlevel.py:139-146" data-src="diff:test-with_dummyserver-test_socketlevel.py:139-146"><g class="c2FtZQ=="><g class="shape"><rect x="1576" y="0" width="231" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1691.5" y="38.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPMessage same object</text></g></a><g class="KHNlcnZlciAtJmd0OyBjbGllbnQpWzBd"><marker id="d2-5897a4452ede567b-mk-d2-2921080108-3488378134" markerWidth="10" markerHeight="12" refX="7" refY="6" viewBox="0 0 10 12" orient="auto" markerUnits="userSpaceOnUse"> <polygon points="0,0 10,6 0,12" fill="#0D32B2" class="connection fill-B1" stroke-width="2"/> </marker><path d="M 196 96 C 249.199997 96 276.799988 96 328 96" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-2921080108-3488378134)" mask="url(#d2-5897a4452ede567b-d2-2921080108)"/></g><g class="KGNsaWVudCAtJmd0OyBtc2cpWzBd"><path d="M 561 96 C 614.200012 96 641.799988 96 693 96" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-2921080108-3488378134)" mask="url(#d2-5897a4452ede567b-d2-2921080108)"/></g><g class="KG1zZyAtJmd0OyBub3JtKVswXQ=="><path d="M 967 96 C 1020.200012 96 1047.800049 96 1099 96" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-2921080108-3488378134)" mask="url(#d2-5897a4452ede567b-d2-2921080108)"/></g><g class="KG5vcm0gLSZndDsgZGljdClbMF0="><path d="M 1340.930281 127.523466 C 1433.400024 152.600006 1480.599976 159 1571 159" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-2921080108-3488378134)" mask="url(#d2-5897a4452ede567b-d2-2921080108)"/><text x="1455" y="161" fill="#676C7E" class="text-italic fill-N2" style="text-anchor:middle;font-size:16px">new dict</text></g><g class="KG5vcm0gLSZndDsgc2FtZSlbMF0="><path d="M 1340.930281 64.476534 C 1433.400024 39.400002 1480.800049 33 1572 33" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-2921080108-3488378134)" mask="url(#d2-5897a4452ede567b-d2-2921080108)"/><text x="1456" y="42" fill="#676C7E" class="text-italic fill-N2" style="text-anchor:middle;font-size:16px">rebuilt in place</text></g><g transform="translate(1323 47)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-5897a4452ede567b-clip0_3440_35088111-d2-2921080108-NZXXE3I)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-5897a4452ede567b-clip0_3440_35088111-d2-2921080108-NZXXE3I">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(1792 110)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-5897a4452ede567b-clip0_3440_35088111-d2-2921080108-MRUWG5A)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-5897a4452ede567b-clip0_3440_35088111-d2-2921080108-MRUWG5A">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(1791 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-5897a4452ede567b-clip0_3440_35088111-d2-2921080108-ONQW2ZI)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-5897a4452ede567b-clip0_3440_35088111-d2-2921080108-ONQW2ZI">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><mask id="d2-5897a4452ede567b-d2-2921080108" x="-21" y="-38" width="1867" height="251">
<rect x="-21" y="-38" width="1867" height="251" fill="white"></rect>
<rect x="1425" y="145" width="60" height="21" fill="black"></rect>
<rect x="1405" y="26" width="102" height="21" fill="black"></rect>
</mask></svg></svg>
`,o0=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-d2-version="v0.9.0" preserveAspectRatio="xMinYMin meet" viewBox="0 0 1867 251"><svg class="d2-824815706 d2-svg" width="1867" height="251" viewBox="-21 -38 1867 251"><rect x="-21" y="-38" width="1867" height="251" rx="0" fill="#1E1E2E" class=" fill-N7" stroke-width="0"/><style><![CDATA[
.appendix-icon {
	filter: drop-shadow(0px 0px 32px rgba(31, 36, 58, 0.1));
}
.d2-824815706 .text-bold {
	font-family: "d2-824815706-font-bold";
}
@font-face {
	font-family: d2-824815706-font-bold;
	src: url("data:application/font-woff;base64,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");
}
.d2-824815706 .text-italic {
	font-family: "d2-824815706-font-italic";
}
@font-face {
	font-family: d2-824815706-font-italic;
	src: url("data:application/font-woff;base64,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");
}]]></style><style><![CDATA[.shape {
  shape-rendering: geometricPrecision;
  stroke-linejoin: round;
}
.connection {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.blend {
  mix-blend-mode: multiply;
  opacity: 0.5;
}

		.d2-824815706 .fill-N1{fill:#CDD6F4;}
		.d2-824815706 .fill-N2{fill:#BAC2DE;}
		.d2-824815706 .fill-N7{fill:#1E1E2E;}
		.d2-824815706 .fill-B1{fill:#CBA6f7;}
		.d2-824815706 .fill-B6{fill:#313244;}
		.d2-824815706 .stroke-B1{stroke:#CBA6f7;}
		.d2-824815706 .stroke-B2{stroke:#CBA6f7;}.appendix text.text{fill:#CDD6F4}.md{--color-fg-default:#CDD6F4;--color-fg-muted:#BAC2DE;--color-fg-subtle:#A6ADC8;--color-canvas-default:#1E1E2E;--color-canvas-subtle:#313244;--color-border-default:#CBA6f7;--color-border-muted:#CBA6f7;--color-neutral-muted:#313244;--color-accent-fg:#CBA6f7;--color-accent-emphasis:#CBA6f7;--color-attention-subtle:#BAC2DE;--color-danger-fg:red;}.light-code{display: none}.dark-code{display: block}]]></style><g class="c2VydmVy"><g class="shape"><rect x="0" y="63" width="194" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="97" y="101.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">Server folded header</text></g><g class="Y2xpZW50"><g class="shape"><rect x="332" y="63" width="227" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="445.5" y="101.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">http.client parse_headers</text></g><g class="bXNn"><g class="shape"><rect x="697" y="63" width="268" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="831" y="101.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPMessage value keeps CRLF</text></g><a href="#" data-refs="diff:src-urllib3-connection.py:91-110" data-src="diff:src-urllib3-connection.py:91-110"><g class="bm9ybQ=="><g class="shape"><rect x="1103" y="63" width="236" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1221" y="101.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">_normalize_header_values</text></g></a><a href="#" data-refs="diff:src-urllib3-connection.py:650-651" data-src="diff:src-urllib3-connection.py:650-651"><g class="ZGljdA=="><g class="shape"><rect x="1575" y="126" width="233" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1691.5" y="164.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPHeaderDict r.headers</text></g></a><a href="#" data-refs="diff:test-with_dummyserver-test_socketlevel.py:139-146" data-src="diff:test-with_dummyserver-test_socketlevel.py:139-146"><g class="c2FtZQ=="><g class="shape"><rect x="1576" y="0" width="231" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="1691.5" y="38.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">HTTPMessage same object</text></g></a><g class="KHNlcnZlciAtJmd0OyBjbGllbnQpWzBd"><marker id="d2-5897a4452ede567b-mk-d2-824815706-3488378134" markerWidth="10" markerHeight="12" refX="7" refY="6" viewBox="0 0 10 12" orient="auto" markerUnits="userSpaceOnUse"> <polygon points="0,0 10,6 0,12" fill="#CBA6f7" class="connection fill-B1" stroke-width="2"/> </marker><path d="M 196 96 C 249.199997 96 276.799988 96 328 96" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-824815706-3488378134)" mask="url(#d2-5897a4452ede567b-d2-824815706)"/></g><g class="KGNsaWVudCAtJmd0OyBtc2cpWzBd"><path d="M 561 96 C 614.200012 96 641.799988 96 693 96" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-824815706-3488378134)" mask="url(#d2-5897a4452ede567b-d2-824815706)"/></g><g class="KG1zZyAtJmd0OyBub3JtKVswXQ=="><path d="M 967 96 C 1020.200012 96 1047.800049 96 1099 96" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-824815706-3488378134)" mask="url(#d2-5897a4452ede567b-d2-824815706)"/></g><g class="KG5vcm0gLSZndDsgZGljdClbMF0="><path d="M 1340.930281 127.523466 C 1433.400024 152.600006 1480.599976 159 1571 159" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-824815706-3488378134)" mask="url(#d2-5897a4452ede567b-d2-824815706)"/><text x="1455" y="161" fill="#BAC2DE" class="text-italic fill-N2" style="text-anchor:middle;font-size:16px">new dict</text></g><g class="KG5vcm0gLSZndDsgc2FtZSlbMF0="><path d="M 1340.930281 64.476534 C 1433.400024 39.400002 1480.800049 33 1572 33" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-5897a4452ede567b-mk-d2-824815706-3488378134)" mask="url(#d2-5897a4452ede567b-d2-824815706)"/><text x="1456" y="42" fill="#BAC2DE" class="text-italic fill-N2" style="text-anchor:middle;font-size:16px">rebuilt in place</text></g><g transform="translate(1323 47)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-5897a4452ede567b-clip0_3440_35088111-d2-824815706-NZXXE3I)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-5897a4452ede567b-clip0_3440_35088111-d2-824815706-NZXXE3I">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(1792 110)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-5897a4452ede567b-clip0_3440_35088111-d2-824815706-MRUWG5A)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-5897a4452ede567b-clip0_3440_35088111-d2-824815706-MRUWG5A">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(1791 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-5897a4452ede567b-clip0_3440_35088111-d2-824815706-ONQW2ZI)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-5897a4452ede567b-clip0_3440_35088111-d2-824815706-ONQW2ZI">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><mask id="d2-5897a4452ede567b-d2-824815706" x="-21" y="-38" width="1867" height="251">
<rect x="-21" y="-38" width="1867" height="251" fill="white"></rect>
<rect x="1425" y="145" width="60" height="21" fill="black"></rect>
<rect x="1405" y="26" width="102" height="21" fill="black"></rect>
</mask></svg></svg>
`,a0=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-d2-version="v0.9.0" preserveAspectRatio="xMinYMin meet" viewBox="0 0 742 125"><svg class="d2-3442407992 d2-svg" width="742" height="125" viewBox="-21 -38 742 125"><rect x="-21" y="-38" width="742" height="125" rx="0" fill="#FFFFFF" class=" fill-N7" stroke-width="0"/><style><![CDATA[
.appendix-icon {
	filter: drop-shadow(0px 0px 32px rgba(31, 36, 58, 0.1));
}
.d2-3442407992 .text-bold {
	font-family: "d2-3442407992-font-bold";
}
@font-face {
	font-family: d2-3442407992-font-bold;
	src: url("data:application/font-woff;base64,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");
}
.d2-3442407992 .text-italic {
	font-family: "d2-3442407992-font-italic";
}
@font-face {
	font-family: d2-3442407992-font-italic;
	src: url("data:application/font-woff;base64,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");
}]]></style><style><![CDATA[.shape {
  shape-rendering: geometricPrecision;
  stroke-linejoin: round;
}
.connection {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.blend {
  mix-blend-mode: multiply;
  opacity: 0.5;
}

		.d2-3442407992 .fill-N1{fill:#0A0F25;}
		.d2-3442407992 .fill-N2{fill:#676C7E;}
		.d2-3442407992 .fill-N7{fill:#FFFFFF;}
		.d2-3442407992 .fill-B1{fill:#0D32B2;}
		.d2-3442407992 .fill-B6{fill:#F7F8FE;}
		.d2-3442407992 .stroke-B1{stroke:#0D32B2;}
		.d2-3442407992 .stroke-B2{stroke:#0D32B2;}.appendix text.text{fill:#0A0F25}.md{--color-fg-default:#0A0F25;--color-fg-muted:#676C7E;--color-fg-subtle:#9499AB;--color-canvas-default:#FFFFFF;--color-canvas-subtle:#EEF1F8;--color-border-default:#0D32B2;--color-border-muted:#0D32B2;--color-neutral-muted:#EEF1F8;--color-accent-fg:#0D32B2;--color-accent-emphasis:#0D32B2;--color-attention-subtle:#676C7E;--color-danger-fg:red;}.light-code{display: block}.dark-code{display: none}]]></style><a href="#" data-refs="diff:test-test_connection.py:220" data-src="diff:test-test_connection.py:220"><g class="d2lyZQ=="><g class="shape"><rect x="0" y="0" width="127" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="63.5" y="38.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">On the wire</text></g></a><a href="#" data-refs="diff:test-test_connection.py:214-222" data-src="diff:test-test_connection.py:214-222"><g class="dW5mb2xkZWQ="><g class="shape"><rect x="529" y="0" width="154" height="66" stroke="#0D32B2" fill="#F7F8FE" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="606" y="38.5" fill="#0A0F25" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">After unfolding</text></g></a><g class="KHdpcmUgLSZndDsgdW5mb2xkZWQpWzBd"><marker id="d2-d604f9a8e9fb637c-mk-d2-3442407992-3488378134" markerWidth="10" markerHeight="12" refX="7" refY="6" viewBox="0 0 10 12" orient="auto" markerUnits="userSpaceOnUse"> <polygon points="0,0 10,6 0,12" fill="#0D32B2" class="connection fill-B1" stroke-width="2"/> </marker><path d="M 129 33 C 287.799988 33 368.200012 33 525 33" stroke="#0D32B2" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-d604f9a8e9fb637c-mk-d2-3442407992-3488378134)" mask="url(#d2-d604f9a8e9fb637c-d2-3442407992)"/><text x="328.5" y="39" fill="#676C7E" class="text-italic fill-N2" style="text-anchor:middle;font-size:16px">the fold becomes one space</text></g><g transform="translate(111 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-3442407992-O5UXEZI)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-3442407992-O5UXEZI">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(667 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-3442407992-OVXGM33MMRSWI)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-3442407992-OVXGM33MMRSWI">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><mask id="d2-d604f9a8e9fb637c-d2-3442407992" x="-21" y="-38" width="742" height="125">
<rect x="-21" y="-38" width="742" height="125" fill="white"></rect>
<rect x="236" y="23" width="185" height="21" fill="black"></rect>
</mask></svg></svg>
`,l0=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-d2-version="v0.9.0" preserveAspectRatio="xMinYMin meet" viewBox="0 0 742 125"><svg class="d2-2884861630 d2-svg" width="742" height="125" viewBox="-21 -38 742 125"><rect x="-21" y="-38" width="742" height="125" rx="0" fill="#1E1E2E" class=" fill-N7" stroke-width="0"/><style><![CDATA[
.appendix-icon {
	filter: drop-shadow(0px 0px 32px rgba(31, 36, 58, 0.1));
}
.d2-2884861630 .text-bold {
	font-family: "d2-2884861630-font-bold";
}
@font-face {
	font-family: d2-2884861630-font-bold;
	src: url("data:application/font-woff;base64,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");
}
.d2-2884861630 .text-italic {
	font-family: "d2-2884861630-font-italic";
}
@font-face {
	font-family: d2-2884861630-font-italic;
	src: url("data:application/font-woff;base64,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");
}]]></style><style><![CDATA[.shape {
  shape-rendering: geometricPrecision;
  stroke-linejoin: round;
}
.connection {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.blend {
  mix-blend-mode: multiply;
  opacity: 0.5;
}

		.d2-2884861630 .fill-N1{fill:#CDD6F4;}
		.d2-2884861630 .fill-N2{fill:#BAC2DE;}
		.d2-2884861630 .fill-N7{fill:#1E1E2E;}
		.d2-2884861630 .fill-B1{fill:#CBA6f7;}
		.d2-2884861630 .fill-B6{fill:#313244;}
		.d2-2884861630 .stroke-B1{stroke:#CBA6f7;}
		.d2-2884861630 .stroke-B2{stroke:#CBA6f7;}.appendix text.text{fill:#CDD6F4}.md{--color-fg-default:#CDD6F4;--color-fg-muted:#BAC2DE;--color-fg-subtle:#A6ADC8;--color-canvas-default:#1E1E2E;--color-canvas-subtle:#313244;--color-border-default:#CBA6f7;--color-border-muted:#CBA6f7;--color-neutral-muted:#313244;--color-accent-fg:#CBA6f7;--color-accent-emphasis:#CBA6f7;--color-attention-subtle:#BAC2DE;--color-danger-fg:red;}.light-code{display: none}.dark-code{display: block}]]></style><a href="#" data-refs="diff:test-test_connection.py:220" data-src="diff:test-test_connection.py:220"><g class="d2lyZQ=="><g class="shape"><rect x="0" y="0" width="127" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="63.5" y="38.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">On the wire</text></g></a><a href="#" data-refs="diff:test-test_connection.py:214-222" data-src="diff:test-test_connection.py:214-222"><g class="dW5mb2xkZWQ="><g class="shape"><rect x="529" y="0" width="154" height="66" stroke="#CBA6f7" fill="#313244" class=" stroke-B1 fill-B6" style="stroke-width:2;"/></g><text x="606" y="38.5" fill="#CDD6F4" class="text-bold fill-N1" style="text-anchor:middle;font-size:16px">After unfolding</text></g></a><g class="KHdpcmUgLSZndDsgdW5mb2xkZWQpWzBd"><marker id="d2-d604f9a8e9fb637c-mk-d2-2884861630-3488378134" markerWidth="10" markerHeight="12" refX="7" refY="6" viewBox="0 0 10 12" orient="auto" markerUnits="userSpaceOnUse"> <polygon points="0,0 10,6 0,12" fill="#CBA6f7" class="connection fill-B1" stroke-width="2"/> </marker><path d="M 129 33 C 287.799988 33 368.200012 33 525 33" stroke="#CBA6f7" fill="none" class="connection stroke-B1" style="stroke-width:2;" marker-end="url(#d2-d604f9a8e9fb637c-mk-d2-2884861630-3488378134)" mask="url(#d2-d604f9a8e9fb637c-d2-2884861630)"/><text x="328.5" y="39" fill="#BAC2DE" class="text-italic fill-N2" style="text-anchor:middle;font-size:16px">the fold becomes one space</text></g><g transform="translate(111 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-2884861630-O5UXEZI)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-2884861630-O5UXEZI">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><g transform="translate(667 -16)" class="appendix-icon"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-2884861630-OVXGM33MMRSWI)">
<path d="M16 31.1109C24.3456 31.1109 31.1111 24.3454 31.1111 15.9998C31.1111 7.65415 24.3456 0.888672 16 0.888672C7.65436 0.888672 0.888885 7.65415 0.888885 15.9998C0.888885 24.3454 7.65436 31.1109 16 31.1109Z" fill="white" stroke="#DEE1EB"/>
<path d="M14.3909 16.7965C14.7364 17.2584 15.1772 17.6406 15.6834 17.9171C16.1896 18.1938 16.7494 18.3582 17.3248 18.3993C17.9001 18.4405 18.4777 18.3575 19.0181 18.1559C19.5586 17.9543 20.0492 17.6389 20.4571 17.2309L22.8708 14.8173C23.6036 14.0586 24.0089 13.0425 23.9998 11.9877C23.9906 10.933 23.5676 9.92404 22.8217 9.17821C22.0759 8.43237 21.067 8.00931 20.0123 8.00015C18.9575 7.99098 17.9413 8.39644 17.1827 9.1292L15.7988 10.505" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M17.609 15.1874C17.2635 14.7255 16.8227 14.3433 16.3165 14.0667C15.8103 13.7902 15.2505 13.6257 14.6752 13.5845C14.0998 13.5433 13.5223 13.6263 12.9819 13.8279C12.4414 14.0295 11.9506 14.345 11.5428 14.753L9.1292 17.1666C8.39644 17.9252 7.99098 18.9414 8.00015 19.9962C8.00931 21.0509 8.43237 22.0598 9.17821 22.8056C9.92405 23.5515 10.933 23.9745 11.9877 23.9837C13.0425 23.9928 14.0586 23.5875 14.8173 22.8547L16.193 21.4788" stroke="#2E3346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<clipPath id="d2-d604f9a8e9fb637c-clip0_3440_35088111-d2-2884861630-OVXGM33MMRSWI">
<rect width="32" height="32" fill="white"/>
</clipPath>
</defs>
</svg>
</g><mask id="d2-d604f9a8e9fb637c-d2-2884861630" x="-21" y="-38" width="742" height="125">
<rect x="-21" y="-38" width="742" height="125" fill="white"></rect>
<rect x="236" y="23" width="185" height="21" fill="black"></rect>
</mask></svg></svg>
`;function Ks(e){const n=e==="dark",t=n?"#191d23":"#ffffff",r=n?"#20252d":"#f7f8fe",s=n?"#56c2cb":"#0d32b2";return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 150" data-mock-theme="${e}"><style>.d2mock-box{fill:${r};stroke:${s};stroke-width:1.5;}.d2mock-t{fill:${n?"#e5e8ed":"#0a0f25"};font:12px sans-serif;}</style><rect x="0" y="0" width="340" height="150" fill="${t}"/><a href="#" data-refs="diff:src-urllib3-connection.py:80-82" data-src="diff:src-urllib3-connection.py:80-82"><rect id="d2mock-a" class="d2mock-box" x="12" y="45" width="130" height="60" rx="6"/><text class="d2mock-t" x="24" y="80">added (mock)</text></a><a href="#" data-refs="diff:src-urllib3-connection.py:91-110" data-src="diff:src-urllib3-connection.py:91-110" data-unverified="true"><rect id="d2mock-b" class="d2mock-box" x="198" y="45" width="130" height="60" rx="6"/><text class="d2mock-t" x="210" y="80">dict ${e}</text></a><path d="M142 75 H198" stroke="${s}" stroke-width="1.5" fill="none"/></svg>`}const c0={f23beae236cc0685:{light:r0,dark:s0},"5897a4452ede567b":{light:i0,dark:o0},d604f9a8e9fb637c:{light:a0,dark:l0},"mock-d2-added":{light:Ks("light"),dark:Ks("dark")},"mock-d2-unverified":{light:Ks("light"),dark:Ks("dark")}};function d0(e,n){if(e==="mock-d2-unavailable")throw new Bi("unavailable","The d2 binary was not found on the service machine.");const t=c0[e];if(!t)throw new Error(`GET /api/reviews/demo/diagrams/${e}: 404 {"error":"unknown diagram"}`);return n==="dark"?t.dark:t.light}const ah=`unfold: "folded value" {
  link: "diff:src-urllib3-connection.py:80-82"
}
dict: "HTTPHeaderDict" {
  link: "diff:src-urllib3-connection.py:91-110"
}
unfold -> dict: "normalize"
`;function u0(){return{type:"diagram",id:"b-mock-d2-edge",source:ah,caption:"Mock D2 edge cases: unverified citation.",citations:[{target:"diff:src-urllib3-connection.py:80-82"},{target:"diff:src-urllib3-connection.py:91-110",unverified:!0}],render:{hash:"mock-d2-unverified",status:"ok"}}}function f0(){return{type:"diagram",id:"b-mock-d2-unavailable",source:`needs-binary: "a diagram" {
  link: "diff:src-urllib3-connection.py:80-82"
}
`,citations:[{target:"diff:src-urllib3-connection.py:80-82"}],render:{hash:"mock-d2-unavailable",status:"unavailable",error:"The d2 binary was not found on the service machine."}}}function p0(){return{type:"diagram",id:`b-mock-dg-${Date.now().toString(36)}`,source:ah,caption:"Mock diagram: unfolding before interpretation.",citations:[{target:"diff:src-urllib3-connection.py:80-82"}],render:{hash:"mock-d2-added",status:"ok"}}}const Oo={},h0=typeof import.meta<"u"&&(Oo==null?void 0:Oo.VITE_MOCK)==="1",tn=e=>new Promise(n=>setTimeout(n,e)),Fe=Date.now(),m0=[{id:"urllib3",owner:"urllib3",name:"urllib3",localPath:"~/code/urllib3",lastOpened:Fe},{id:"demo-lib",owner:"you",name:"demo-lib",localPath:"~/code/demo-lib",lastOpened:0,detected:!0}],qa="unvibe.mock.addedRepos";function oc(e,n){try{const t=localStorage.getItem(e);return t?JSON.parse(t):n}catch{return n}}function Qd(){return[...oc(qa,[]),...m0]}const Hn={n:1,headSha:"bdcc1e493e",mergeBaseSha:"443cb01be1",baseRef:"main",fetchedAt:Fe,idMapping:{}},Qa={id:"demo",repoId:"urllib3",branch:"fix-obs-fold",prNumber:5020,versions:[Hn],currentVersion:1,createdAt:Fe-36e5};function lh(){const e=new Map;for(const n of Kt)n.hunks.forEach((t,r)=>{n.path==="test/test_connection.py"&&r===2?e.set(t.contentHash,{contentHash:t.contentHash,folded:!0,reviewed:!0}):n.path==="src/urllib3/connection.py"&&r===1&&e.set(t.contentHash,{contentHash:t.contentHash,folded:!1,reviewed:!1,note:"Only call site; everything else is the helper."})});return e}const A0={...t0,editable:!0,source:"pr"},g0=[{re:/\blf\b|bare|newline only/i,a:'Not with this PR. The fast path checks for <code>"\\r\\n"</code> and the pattern requires <code>\\r\\n</code>. <code>http.client</code> also accepts header lines that end in a bare LF, which passes through unchanged.'},{re:/order|ordering|duplicate/i,a:"Order and duplicates are preserved. The helper works on <code>message.items()</code>, a list of pairs, then re-adds the list in its original order."},{re:/cost|slow|performance|quadratic|speed/i,a:"Cheap in practice. Values without CRLF skip the regex, and the message is only rewritten when something changed."},{re:/test|cover/i,a:"Two levels. Unit tests cover the value helper and the message helper (order, duplicates, defects, policy). A socket-level test sends a real folded response through a pool and checks both header views."},{re:/two spaces|double space|adjacent/i,a:"Yes. RFC 9112 allows replacing each fold with <em>one or more</em> spaces, and the helper replaces each fold with exactly one, so two adjacent folds give two spaces."}];function Ho(e,n){const t=g0.find(s=>s.re.test(`${e} ${n}`));return t?t.a:`Mock answer${n?` about <em>“${n.replace(/</g,"&lt;")}”</em>`:""}: the live agent would answer this from the repo and the PR. In mock mode this is a canned reply so threads can be exercised end to end.`}function _s(e){const n=e.replace(/</g,"&lt;").slice(0,120)||"this text";return[{type:"paragraph",id:`b-mock-exp-${Date.now().toString(36)}`,text:{simple:`In short: <em>${n}</em> is about unfolding folded header values.`,standard:`Mock explanation of <em>${n}</em>: the helper replaces each fold with one space before urllib3 reads the value. [[diff:src-urllib3-connection.py:80-82]]`,deep:`Mock deep explanation of <em>${n}</em>: obs-fold handling sits at the recipient per RFC 9112 §5.2, before interpretation or forwarding, so every consumer sees one semantic value. [[diff:src-urllib3-connection.py:80-88]]`},citations:[{target:"diff:src-urllib3-connection.py:80-82"}]}]}function v0(){return{type:"aside",id:`b-mock-ex-${Date.now().toString(36)}`,kind:"Example",inner:[{type:"code",id:`b-mock-ex-${Date.now().toString(36)}-c`,code:`# mock example
# urllib3 now returns: 'a=1; path=/ Max-Age=900'`,citations:[]}],citations:[]}}function x0(){return p0()}function Zd(){return{type:"aside",id:`b-mock-pr-${Date.now().toString(36)}`,kind:"Underlying principle",inner:[{type:"paragraph",id:`b-mock-pr-${Date.now().toString(36)}-p`,text:{standard:"Resolve encoding at the recipient, before interpretation."},citations:[]}],citations:[]}}function ch(e){for(const t of Te){const r=t.cards.find(s=>s.id===e);if(r)return{kind:"page",pageId:t.id,card:r}}const n=J.find(t=>t.id===e);return(n==null?void 0:n.type)==="expansion"&&n.expansion?{kind:"expansion",annotation:n}:null}function Yd(e){return e.kind==="page"?e.card.blocks:e.annotation.expansion.blocks}function Xd(e){return e.kind==="page"?e.card.level:e.annotation.expansion.level}function k0(e){const n=ch(e.cardId);if(!n)throw new Error(`unknown card ${e.cardId}`);const t=["simple","standard","deep"];if(e.kind==="depth"&&(e.direction==="simpler"||e.direction==="deeper")){const r=Xd(n),s=t.indexOf(r),i=e.direction==="simpler"?t[s-1]:t[s+1],o=Yd(n);if(!i){if(e.direction==="deeper"&&!o.some(d=>d.type==="aside"&&d.kind==="Underlying principle")){const d=[...o];return n.kind==="page"?(n.card.undoStack.push({blocks:JSON.parse(JSON.stringify(d)),level:r}),n.card.blocks=[...d,Zd()],n.card.revision+=1):(n.annotation.expansion.undoStack.push({blocks:JSON.parse(JSON.stringify(d)),level:r}),n.annotation.expansion.blocks=[...d,Zd()],n.annotation.expansion.revision+=1),Ue(),Y(),{accepted:!0,cardId:e.cardId}}return{accepted:!0,cardId:e.cardId}}const l=r,c=[...o];return n.kind==="page"?(n.card.undoStack.push({blocks:JSON.parse(JSON.stringify(c)),level:l}),n.card.level=i,n.card.revision+=1):(n.annotation.expansion.undoStack.push({blocks:JSON.parse(JSON.stringify(c)),level:l}),n.annotation.expansion.level=i,n.annotation.expansion.revision+=1),Ue(),Y(),{accepted:!0,cardId:e.cardId}}if(e.kind==="examples"||e.kind==="diagram"){const r=Yd(n),s=Xd(n),i=e.kind==="examples"?"Example":null;if(i&&r.some(u=>u.type==="aside"&&u.kind===i))return{accepted:!0,cardId:e.cardId};if(e.kind==="diagram"&&r.some(u=>u.type==="diagram"))return{accepted:!0,cardId:e.cardId};const o=[...r],l=e.kind==="examples"?v0():x0(),c=o.findIndex(u=>u.type==="paragraph"),d=c>=0?[...o.slice(0,c+1),l,...o.slice(c+1)]:[...o,l];return n.kind==="page"?(n.card.undoStack.push({blocks:JSON.parse(JSON.stringify(o)),level:s}),n.card.blocks=d,n.card.revision+=1):(n.annotation.expansion.undoStack.push({blocks:JSON.parse(JSON.stringify(o)),level:s}),n.annotation.expansion.blocks=d,n.annotation.expansion.revision+=1),Ue(),Y(),{accepted:!0,cardId:e.cardId}}if(e.kind==="undo"){if(n.kind==="page"){const r=n.card.undoStack.pop();if(!r)return{accepted:!0,cardId:e.cardId};n.card.blocks=r.blocks,n.card.level=r.level,n.card.revision+=1}else{const r=n.annotation.expansion.undoStack.pop();if(!r)return{accepted:!0,cardId:e.cardId};n.annotation.expansion.blocks=r.blocks,n.annotation.expansion.level=r.level,n.annotation.expansion.revision+=1}return Ue(),Y(),{accepted:!0,cardId:e.cardId}}throw new Error(`unknown mock card control ${e.kind}`)}let ke=1;const Tt=lh();let J=JSON.parse(JSON.stringify(n0)),Te=JSON.parse(JSON.stringify(oh));function w0(e){var t;const n=(t=e.find(r=>r.id==="root"))==null?void 0:t.cards.find(r=>r.id==="g-flow");!n||n.blocks.some(r=>r.id==="b-mock-d2-edge")||(n.blocks=[...n.blocks,u0(),f0()])}w0(Te);let ge={...A0},ac=[{id:101,path:"src/urllib3/connection.py",line:82,side:"RIGHT",body:"Already on GitHub: consider covering bare LF here too.",author:"teammate",createdAt:"2026-09-01T12:00:00Z",htmlUrl:"https://github.com/urllib3/urllib3/pull/5020#discussion_r101"}];const dh="unvibe.mock.settings",y0={main:{provider:"claude",model:"mock-main"},small:{provider:"claude",model:"mock-small"},secondOpinion:{provider:"codex",model:"mock-second"},sessionsPerProvider:4,inlineBudgetTokens:4e4,rebuildSupersededRatio:.2,rebuildAppendedTokens:1e4,cacheLifetimeMs:3e5,idleExitMinutes:10};function Jd(){return{...y0,...oc(dh,{})}}function b0(){return[{id:"job-reader-1",kind:"reader",provider:"claude",model:"mock-main",reviewId:"demo",priority:10,state:"done",sessionId:"sess-reader-1",promptSnapshot:"You are the reader: explore the repo and write the guided review.",usage:{inputTokens:48200,cachedTokens:0,outputTokens:6300},cacheHitRate:0,progress:"Finished: 6 cards"},{id:"job-explain-1",kind:"explain",provider:"claude",model:"mock-main",reviewId:"demo",priority:100,state:"running",sessionId:"sess-reader-1",cardId:"central",promptSnapshot:"Explain the quoted text with citations to the diff.",usage:{inputTokens:42500,cachedTokens:38900,outputTokens:1200},cacheHitRate:.915,progress:"Streaming answer…"},{id:"job-hunk-1",kind:"hunk-pass",provider:"codex",model:"mock-small",reviewId:"demo",priority:10,state:"queued",promptSnapshot:"Summarize this hunk in one line."},{id:"job-critic-1",kind:"critic",provider:"claude",model:"mock-main",reviewId:"demo",priority:50,state:"backing-off",attempts:2,nextRetryAt:Date.now()+45e3,error:"429 rate limited",promptSnapshot:"Critique the change: findings with evidence."}]}let mn=b0();function C0(){return[{id:"ct-seed-1",sourceSession:"sess-reader-1",items:[{kind:"fact",text:"Folded header values are unfolded lazily on first access.",citations:[{target:"diff:src-urllib3-connection.py:640-660"}]},{kind:"reader_note",text:"The reader found the regex section hard to follow.",citations:[]}],status:"pending"},{id:"ct-seed-2",sourceSession:"t-seed",items:[{kind:"correction",text:"The central card overstates the scope: only response headers change.",target:"card:central#b-rule",citations:[]},{kind:"open_question",text:"Is the new helper covered by a socket-level test?",citations:[]}],status:"pending"}]}let rn=C0();function S0(){const e=Kt.reduce((t,r)=>t+r.hunks.length,0),n=[...lh().values()].filter(t=>t.reviewed).length;return[{id:"demo",repoId:"urllib3",repoOwner:"urllib3",repoName:"urllib3",title:"Unfold obsolete folded response header values",branch:"fix-obs-fold",prNumber:5020,createdAt:Fe-36e5,lastOpened:Fe-6e5,versionCount:1,currentVersion:1,stale:!1,totalHunks:e,reviewedHunks:n,pendingComments:1,guideStatus:"ready"},{id:"r-old",repoId:"urllib3",repoOwner:"urllib3",repoName:"urllib3",title:"Fix retry backoff on 429s",branch:"fix-retry-backoff",prNumber:5011,createdAt:Fe-864e5*2,lastOpened:Fe-864e5,versionCount:2,currentVersion:2,stale:!0,totalHunks:e,reviewedHunks:0,pendingComments:0,guideStatus:"running",guideDetail:"Running: critic"}]}let Za=S0();function E0(){return[...Za].sort((e,n)=>n.lastOpened-e.lastOpened)}const j0="unvibe.mock.readiness";function N0(){try{const e=localStorage.getItem(j0);if(e){const n=JSON.parse(e);if(Array.isArray(n.checks))return{...n,cached:!1}}}catch{}return{checks:[{id:"git",label:"git",status:"ok",summary:"git found",fix:"",settingsAnchor:"#environment"},{id:"gh",label:"gh (GitHub CLI)",status:"ok",summary:"gh logged in as you",fix:"",settingsAnchor:"#environment"},{id:"agent:main",label:"Agent · main",status:"ok",summary:"claude/mock-main ready",fix:"",settingsAnchor:"#models"},{id:"agent:small",label:"Agent · small",status:"ok",summary:"claude/mock-small ready",fix:"",settingsAnchor:"#models"},{id:"agent:secondOpinion",label:"Agent · second opinion",status:"ok",summary:"codex/mock-second ready",fix:"",settingsAnchor:"#models"},{id:"agents-distinct",label:"Second opinion independence",status:"ok",summary:"Second opinion differs from main",fix:"",settingsAnchor:"#models"}],generatedAt:Date.now(),cached:!1}}function li(e){return e==="r-old"||e==="stale-demo"}const L0=["1:  a1b2c3d ! unfold folded response headers","    +++ e4f5a6b ! unfold folded response headers (amended)","-:  ------- > 2:  c7d8e9f ! add socket-level test for obs-fold"].join(`
`);function uh(){const e=Kt.find(r=>r.path==="test/test_connection.py"),n=e==null?void 0:e.hunks[2],t=n?`h:${e.fileKey}:${n.contentHash}`:"h:unknown:old";return{stale:!0,fromVersion:1,toVersion:2,unchangedHunks:7,changedHunks:1,newHunks:2,removedHunks:0,renamedFiles:[],changedOldIds:[t],changedNewIds:[`${t}:new`],rangeDiff:L0,fetchedAt:Fe}}function T0(){const e=[...Tt.values()],n=Kt.find(r=>r.path==="test/test_connection.py"),t=n==null?void 0:n.hunks[2];return t?e.map(r=>r.contentHash===t.contentHash?{...r,reviewed:!1,folded:!1,stale:!0,needsSummary:!0}:r):e}const R0={...Hn,n:2,headSha:"e4f5a6b7c8d",fetchedAt:Fe};function $d(e="demo",n){const t=li(e),r=n??(t?2:1),s={review:{...Qa,id:e,versions:t?[Hn,R0]:[Hn],currentVersion:t?2:1},version:t?{...Hn,n:r}:Hn,files:Kt,description:ge,pages:e==="demo"?Te:oh,annotations:J,hunkStates:t&&r===2?T0():[...Tt.values()],jobs:mn.filter(i=>i.reviewId===e||e==="demo"&&!i.reviewId),contributions:e==="demo"?rn:[],logTail:[],rev:ke,existingComments:ac};return t&&r===2&&(s.versionStatus=uh()),s}function eu(){const e=ke;ke+=1,D.getState().applyEvent({type:"patch",baseRev:e,headRev:ke,ops:[{op:"replace",path:"/hunkStates",value:[...Tt.values()]}]})}function P0(e){for(const n of Kt){const t=n.hunks.findIndex(r=>r.contentHash===e);if(t>=0)return`${n.fileKey}:${t}`}return null}function Y(){const e=ke;ke+=1,D.getState().applyEvent({type:"patch",baseRev:e,headRev:ke,ops:[{op:"replace",path:"/annotations",value:JSON.parse(JSON.stringify(J))}]})}h0&&typeof window<"u"&&(window.__streamPatches=e=>{for(let n=0;n<e;n++)Y()});function Ue(){const e=ke;ke+=1,D.getState().applyEvent({type:"patch",baseRev:e,headRev:ke,ops:[{op:"replace",path:"/pages",value:JSON.parse(JSON.stringify(Te))}]})}function zo(){const e=ke;ke+=1,D.getState().applyEvent({type:"patch",baseRev:e,headRev:ke,ops:[{op:"replace",path:"/contributions",value:JSON.parse(JSON.stringify(rn))}]})}function Uo(){const e=ke;ke+=1,D.getState().applyEvent({type:"patch",baseRev:e,headRev:ke,ops:[{op:"replace",path:"/description",value:JSON.parse(JSON.stringify(ge))}]})}function M0(){const e=ke;ke+=1,D.getState().applyEvent({type:"patch",baseRev:e,headRev:ke,ops:[{op:"replace",path:"/existingComments",value:JSON.parse(JSON.stringify(ac))}]})}function B0(e){return e.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()}function D0(e){var r;if(e.draft!==void 0&&e.draft!=="")return e.draft;const n=e.messages.find(s=>s.who==="you"&&s.text);if(n!=null&&n.text)return n.text;const t=e.messages.find(s=>s.suggested&&s.text);return t!=null&&t.text?t.text:((r=e.messages.find(s=>s.text))==null?void 0:r.text)??""}function nu(){const e=J.filter(s=>s.type==="thread"&&s.post&&!s.postedAt),n=J.filter(s=>s.type==="thread"&&s.post&&s.postedAt).map(s=>s.id),t=e.map(s=>{const i=s.anchor.host;let o;if(i.kind==="diff-line"){const l=Kt.find(c=>c.fileKey===i.fileKey);o=l?{kind:"inline",path:l.path,line:i.line,side:"RIGHT"}:{kind:"general",reason:`unknown file ${i.fileKey}`}}else o={kind:"general",reason:i.kind==="block"?"guide comment":"description comment"};return{threadId:s.id,location:o,text:D0(s)}}),r=t.filter(s=>s.location.kind!=="inline").map(s=>s.text);return{comments:t,alreadyPosted:n,reviewBody:r.filter(s=>s.trim()!=="").join(`

---

`),commitId:Hn.headSha,...ge.pendingMarkdown!==void 0?{description:{fromRev:ge.rev,markdown:ge.pendingMarkdown,html:ge.pendingHtml??ge.html}}:{}}}const F0={health:async()=>({ok:!0,version:"mock"}),repos:async()=>({repos:Qd()}),addRepo:async e=>{const n=e.path.split("/").filter(Boolean).pop()??e.path,t={id:`local-${n}`,owner:"local",name:n,localPath:e.path,lastOpened:Date.now()};try{const r=oc(qa,[]);localStorage.setItem(qa,JSON.stringify([t,...r]))}catch{}return{repos:Qd()}},repoChanges:async(e,n)=>{const t=[{kind:"pr",title:"Unfold obsolete folded response header values",prNumber:5020,branch:"fix-obs-fold",author:"you",updatedAt:Fe-36e5},{kind:"pr",title:"Fix retry backoff on 429s",prNumber:5011,branch:"fix-retry-backoff",author:"you",updatedAt:Fe-1728e5}],r=[{kind:"pr",title:"Pool: reuse connections across redirects",prNumber:5018,branch:"pool-redirect-reuse",author:"teammate",updatedAt:Fe-72e5}],s=[{kind:"branch",title:"fix-obs-fold",branch:"fix-obs-fold",updatedAt:Fe-36e5},{kind:"branch",title:"main",branch:"main",updatedAt:Fe-864e5},{kind:"branch",title:"experiment/lazy-headers",branch:"experiment/lazy-headers",updatedAt:Fe-864e5*3}],i=[{kind:"review",title:"#5020 · fix-obs-fold",prNumber:5020,branch:"fix-obs-fold",reviewId:"demo",stale:!1},{kind:"review",title:"#5011 · fix-retry-backoff",prNumber:5011,branch:"fix-retry-backoff",reviewId:"r-old",stale:!0}];switch(n){case"authoring":return{changes:t};case"review-requested":return{changes:r};case"branches":return{changes:s};case"recent":return{changes:[...s,...i]};default:return{changes:[...t,...r,...s,...i]}}},createReview:async e=>(await tn(150),$d("demo")),reviews:async()=>(await tn(50),{reviews:E0()}),deleteReview:async e=>{await tn(50);const n=Za.findIndex(t=>t.id===e);if(n<0)throw new Error(`DELETE /api/reviews/${e}: 404 {"error":"unknown review"}`);return Za.splice(n,1),{ok:!0}},readiness:async()=>(await tn(50),N0()),diagramSvg:async(e,n,t)=>(await tn(30),d0(n,t)),review:async(e,n)=>{if(await tn(50),li(e)&&n!==void 0&&n!==1&&n!==2)throw new Error(`GET /api/reviews/${e}?version=${n}: 404 {"error":"unknown version ${n}"}`);return $d(e,n)},refresh:async e=>{if(await tn(100),li(e)){const n=uh();return{review:{...Qa,id:e,currentVersion:2},newVersion:!0,comparison:{oldVersion:n.fromVersion,newVersion:n.toVersion,oldHeadSha:Hn.headSha,newHeadSha:"e4f5a6b7c8",renames:[],rangeDiff:n.rangeDiff,unchangedHunks:n.unchangedHunks,changedHunks:n.changedHunks,newHunks:n.newHunks,removedHunks:n.removedHunks,changedOldIds:n.changedOldIds,changedNewIds:n.changedNewIds},version:{...Hn,n:2}}}return{review:Qa,newVersion:!1}},update:async e=>(await tn(100),{jobId:`mock-update-${e}`,toVersion:li(e)?2:1}),action:async(e,n)=>{var t;if(n.kind==="second_opinion"){const r=`mock-so-${n.cardId}-${n.mode}`,s=n.mode==="blind"?"partly":"disagrees",i=n.mode==="blind"?"A lone CR ending is untested too.":"Set-Cookie comma handling is out of scope.",o={id:`so-${n.cardId}-${n.mode}-mock-second`,cardId:n.cardId,mode:n.mode,provider:"codex",model:"mock-second",verdict:s,reasoning:s==="partly"?"Checked the helper; gap is real but narrow.":"Only CRLF-folded values are rewritten.",blocks:[{type:"paragraph",id:"b-so-1",text:{standard:s==="partly"?"Partly — the gap is real but narrow. The helper handles the fold. [[diff:src-urllib3-connection.py:80-82]]":"Disagrees — only CRLF-folded values are rewritten. [[diff:src-urllib3-connection.py:80-88]]"},citations:[{target:"diff:src-urllib3-connection.py:80-82"}]}],missed:i,version:1,createdAt:Date.now(),jobId:r};return window.setTimeout(()=>{const l=J.find(u=>u.id===n.cardId&&u.type==="expansion");if(l!=null&&l.expansion){const u=(l.expansion.secondOpinions??[]).filter(f=>f.mode!==n.mode);l.expansion.secondOpinions=[...u,{...o,cardId:l.id}],Y();return}const c=D.getState().snapshot;if(!c)return;const d=c.pages.map(u=>({...u,cards:u.cards.map(f=>{if(f.id!==n.cardId)return f;const p=(f.secondOpinions??[]).filter(A=>A.mode!==n.mode);return{...f,secondOpinions:[...p,{...o,cardId:f.id}]}})}));Te=JSON.parse(JSON.stringify(d)),Ue()},400),{accepted:!0,jobId:r}}if(n.kind==="delete"){const r=n.targetId??"",s=r.match(/^second-opinion:([^:]+):(blind|check)$/)??r.match(/^(so-.*)$/);if(s){let o=!1;for(const d of J){if(d.type!=="expansion"||!d.expansion)continue;const u=d.expansion.secondOpinions??[];let f=u;if(s[1].startsWith("so-"))f=u.filter(p=>p.id!==s[1]);else{const p=r.match(/^second-opinion:([^:]+):(blind|check)$/);if(d.id!==p[1])continue;f=u.filter(A=>A.mode!==p[2])}f.length!==u.length&&(d.expansion.secondOpinions=f,o=!0)}if(o)return Y(),{accepted:!0};const l=D.getState().snapshot;if(!l)return{accepted:!1};const c=l.pages.map(d=>({...d,cards:d.cards.map(u=>{const f=u.secondOpinions??[];if(s[1].startsWith("so-")){const v=f.filter(x=>x.id!==s[1]);return v.length===f.length?u:{...u,secondOpinions:v}}const[,p,A]=r.match(/^second-opinion:([^:]+):(blind|check)$/);return u.id!==p?u:{...u,secondOpinions:f.filter(v=>v.mode!==A)}})}));return Te=JSON.parse(JSON.stringify(c)),Ue(),{accepted:!0}}const i=J.findIndex(o=>o.id===r);if(i>=0)return J.splice(i,1),Y(),{accepted:!0,annotationId:r};throw new Error(`DELETE actions ${r}: 404 {"error":"unknown annotation"}`)}if(n.kind==="ask"||n.kind==="reply"||n.kind==="retry"){const r=(s,i,o)=>{tn(700).then(()=>{const l=J.find(c=>c.id===s);!l||l.type!=="thread"||(l.messages.push({who:"ai",html:Ho(i,o)}),l.working=null,l.open=!0,Y())})};if(n.kind==="reply"||n.kind==="retry"){const s=n.threadId,i=J.find(o=>o.id===s);if((i==null?void 0:i.type)==="expansion"&&i.expansion&&n.kind==="retry"){i.error=null,i.expansion.error=null,i.working="Thinking…",i.expansion.working="Thinking…",i.open=!0,Y();const o=i.id,l=i.anchor.quotedText;return window.setTimeout(()=>{const c=J.find(d=>d.id===o);!c||c.type!=="expansion"||!c.expansion||(c.expansion.blocks=_s(l),c.expansion.revision+=1,c.working=null,c.expansion.working=null,Y())},700),{accepted:!0,annotationId:i.id,threadId:i.id,jobId:`mock-retry-${i.id}`}}else{if(!i||i.type!=="thread")throw new Error(`unknown comment ${s}`);if(n.kind==="retry"&&!i.error)throw new Error(`thread ${i.id} has no failed reply to retry`);n.kind==="reply"&&i.messages.push({who:"you",text:n.message}),i.error=null,i.working="Reading…",i.open=!0,Y();const o=[...i.messages].reverse().find(l=>l.who==="you"&&l.text);return r(i.id,(o==null?void 0:o.text)??"",i.anchor.quotedText),{accepted:!0,annotationId:i.id,threadId:i.id,jobId:`mock-${n.kind}-${i.id}`}}}if(n.kind==="ask"){const s=n.anchor,i=s.where==="block"?{kind:"block",blockId:s.blockId}:s.where==="description"?{kind:"description",paragraphId:s.paragraphId}:{kind:"diff-line",fileKey:s.fileKey,line:s.line},o={id:`ann_mock${Math.floor(Math.random()*1e9).toString(36)}${Date.now().toString(36)}`,type:"thread",anchor:{host:i,quotedText:n.quote,prefix:"",suffix:"",position:0,version:1},open:i.kind!=="block",messages:[{who:"you",text:n.message}],post:!1,note:!1,working:"Reading…"};return J.push(o),Y(),r(o.id,n.message,n.quote),{accepted:!0,annotationId:o.id,threadId:o.id,jobId:`mock-ask-${o.id}`}}}if(n.kind==="explain"){const r=n.anchor,s=r.where==="block"?{kind:"block",blockId:r.blockId}:r.where==="description"?{kind:"description",paragraphId:r.paragraphId}:{kind:"diff-line",fileKey:r.fileKey,line:r.line},i=`ann_mock${Math.floor(Math.random()*1e9).toString(36)}${Date.now().toString(36)}`,o=`mock-explain-${i}`;return J.push({id:i,type:"expansion",anchor:{host:s,quotedText:n.quote,prefix:"",suffix:"",position:0,version:1},open:!0,messages:[],post:!1,note:!1,working:"Thinking…",expansion:{blocks:[],level:"standard",read:!1,collapsed:!1,revision:1,undoStack:[],working:"Thinking…"}}),Y(),["Reading the diff…","Checking citations…"].forEach((c,d)=>{window.setTimeout(()=>{D.getState().applyEvent({type:"text",jobId:o,threadId:i,delta:c.slice(0,24)})},120*(d+1))}),window.setTimeout(()=>{const c=J.find(d=>d.id===i);if(!(!c||c.type!=="expansion"||!c.expansion)){if(!c.open){c.expansion.blocks=_s(n.quote),c.expansion.revision+=1,c.working=null,c.expansion.working=null,Y();return}c.expansion.blocks=_s(n.quote),c.expansion.revision+=1,c.working=null,c.expansion.working=null,c.error=null,c.expansion.error=null,Y()}},700),{accepted:!0,annotationId:i,jobId:o}}if(n.kind==="depth"||n.kind==="examples"||n.kind==="diagram"||n.kind==="undo")return k0(n);if(n.kind==="generate"){const r=Te.flatMap(i=>i.cards).find(i=>i.id===n.cardId);if(!r)throw new Error(`unknown card ${n.cardId}`);if(!r.pending)return{accepted:!0,jobId:`mock-generate-${r.id}`};const s=`mock-generate-${r.id}`;return window.setTimeout(()=>{D.getState().applyEvent({type:"text",jobId:s,cardId:r.id,delta:"Reading the diff…"})},120),window.setTimeout(()=>{const i=Te.flatMap(o=>o.cards).find(o=>o.id===r.id);!i||!i.pending||(delete i.pending,i.blocks=[{type:"paragraph",id:`${r.id}-b1`,text:{standard:`Mock generated card for <em>${r.id}</em>: the live agent would fill this from the repo. [[diff:src-urllib3-connection.py:80-82]]`},citations:[{target:"diff:src-urllib3-connection.py:80-82"}]},{type:"follow-up",id:`${r.id}-f1`,items:[{label:"What happens to a fold that ends in a bare LF?",ask:"bare lf"}],citations:[]}],i.revision+=1,Ue())},700),{accepted:!0,jobId:s}}if(n.kind==="followup"){const{cardId:r,blockId:s,index:i}=n,o=Te.flatMap(f=>f.cards).find(f=>f.id===r),l=o==null?void 0:o.blocks.find(f=>f.id===s&&f.type==="follow-up");if(!l||!l.items[i])throw new Error(`unknown follow-up ${i} on block ${s}`);const c=l.items[i];l.items.splice(i,1),Ue();const d=`ann_mock${Math.floor(Math.random()*1e9).toString(36)}${Date.now().toString(36)}`,u=`mock-followup-${d}`;return J.push({id:d,type:"expansion",anchor:{host:{kind:"block",blockId:s},quotedText:c.label,prefix:"",suffix:"",position:0,version:1},open:!0,messages:[],post:!1,note:!1,working:"Thinking…",expansion:{blocks:[],level:"standard",read:!1,collapsed:!1,revision:1,undoStack:[],working:"Thinking…"}}),Y(),window.setTimeout(()=>{const f=J.find(p=>p.id===d);!f||f.type!=="expansion"||!f.expansion||(f.expansion.blocks=_s(c.label),f.expansion.revision+=1,f.working=null,f.expansion.working=null,Y())},700),{accepted:!0,annotationId:d,cardId:r,jobId:u}}if(n.kind==="concept"){const r=n.slug,s=`c-${r}`;let i=Te.find(l=>l.id===s);if(i&&(((t=i.cards[0])==null?void 0:t.blocks.length)??0)>1)return{accepted:!0,pageId:s};i||(Te.push({id:s,kind:"concept",title:r,saved:!0,parent:"root",cards:[{id:`cc-${r}`,pageId:s,title:null,level:"standard",read:!1,collapsed:!1,revision:1,blocks:[],undoStack:[]}]}),Ue(),i=Te.find(l=>l.id===s));const o=`mock-concept-${r}`;return window.setTimeout(()=>{const l=Te.find(c=>c.id===s);l&&(l.title=`${r} (mock concept)`,l.cards=[{id:`cc-${r}`,pageId:s,title:null,level:"standard",read:!1,collapsed:!1,revision:2,blocks:[{type:"paragraph",id:`cc-${r}-b1`,text:{standard:`Mock concept page for <em>${r}</em>: written on first open. [[diff:src-urllib3-connection.py:80-82]]`},citations:[{target:"diff:src-urllib3-connection.py:80-82"}]}],undoStack:[]}],Ue())},700),{accepted:!0,pageId:s,jobId:o}}if(n.kind==="promote"){const r=n.annotationId,s=J.find(d=>d.id===r);if(!s||s.type!=="expansion"||!s.expansion)throw new Error(`annotation ${r} is not an expansion`);const i=s.anchor.quotedText,o=i.length>60?`${i.slice(0,58)}…`:i||"(untitled)",l=`p-mock-${Date.now().toString(36)}`,c=`c-mock-${Date.now().toString(36)}`;return Te.push({id:l,kind:"opened-expansion",title:o,saved:!1,parent:"root",cards:[{id:c,pageId:l,title:null,level:s.expansion.level,read:!1,collapsed:!1,revision:1,blocks:JSON.parse(JSON.stringify(s.expansion.blocks)),undoStack:[]}]}),s.type="link",s.open=!1,s.working=null,s.error=null,s.jobId=void 0,s.promotedToPage=l,delete s.expansion,Ue(),Y(),{accepted:!0,annotationId:r,pageId:l}}if(n.kind==="close"){const r=n.annotationId,s=J.find(i=>i.id===r);if(!s)throw new Error(`unknown annotation ${r}`);return s.open=!1,s.working=null,s.type==="expansion"&&s.expansion&&(s.expansion.working=null),Y(),{accepted:!0,annotationId:r}}if(n.kind!=="read"&&n.kind!=="collapse"&&n.kind!=="bookmark")return{accepted:!1};if(n.kind==="bookmark"){const r=Te.find(s=>s.id===n.pageId);return r?(r.saved=n.saved,Ue(),{accepted:!0}):{accepted:!1}}for(const r of Te)for(const s of r.cards)if(s.id===n.cardId)return n.kind==="read"?(s.read=n.read,s.collapsed=!!n.read):s.collapsed=n.collapsed,Ue(),{accepted:!0};{const r=J.find(s=>s.id===n.cardId);if((r==null?void 0:r.type)==="expansion"&&r.expansion){if(n.kind==="read"){const s=n.read;r.expansion.read=s,s?(r.expansion.collapsed=!0,r.open=!1,r.working=null,r.expansion.working=null):(r.expansion.collapsed=!1,r.open=!0)}else r.expansion.collapsed=n.collapsed;return Y(),{accepted:!0}}}return{accepted:!1}},updateHunk:async(e,n,t)=>{const s={...Tt.get(n)??{contentHash:n,folded:!1,reviewed:!1}};return t.folded!==void 0&&(s.folded=t.folded),t.reviewed!==void 0&&(s.reviewed=t.reviewed),t.note===null?delete s.note:t.note!==void 0&&(s.note=t.note),t.summary===null?delete s.summary:t.summary!==void 0&&(s.summary=t.summary),Tt.set(n,s),eu(),{ok:!0}},summarizeHunk:async(e,n)=>{await tn(600);const t=P0(n),r=t&&$g[t]||"Mock summary: this hunk normalizes folded header values.",s=Tt.get(n)??{contentHash:n,folded:!1,reviewed:!1};return Tt.set(n,{...s,summary:r}),eu(),{jobId:`mock-${n}`}},createComment:async(e,n)=>{var i;const t=n.anchor,r=t.where==="block"?{kind:"block",blockId:t.blockId}:t.where==="description"?{kind:"description",paragraphId:t.paragraphId}:{kind:"diff-line",fileKey:t.fileKey,line:t.line},s={id:`ann_mock${Math.floor(Math.random()*1e9).toString(36)}${Date.now().toString(36)}`,type:"thread",anchor:{host:r,quotedText:n.quote??"",prefix:n.prefix??"",suffix:n.suffix??"",position:n.position??0,version:1},open:r.kind!=="block",messages:n.text?[{who:"you",text:n.text}]:[],post:!1,note:n.note??!0};if(n.suggested&&n.suggestionText&&(s.messages=[{who:"ai",text:n.suggestionText,suggested:!0}],s.note=!1),J.push(s),Y(),!s.note&&s.messages.length>0){const o=((i=s.messages[0])==null?void 0:i.text)??"",l=s.anchor.quotedText,c=s.id;tn(700).then(()=>{const d=J.find(u=>u.id===c);d&&(d.messages.push({who:"ai",html:Ho(o,l)}),d.open=!0,Y())})}return{id:s.id}},replyComment:async(e,n,t)=>{const r=J.find(s=>s.id===n);if(!r||r.type!=="thread")throw new Error("unknown comment");if(r.messages.push({who:"you",text:t.text}),delete r.reply,r.open=!0,Y(),!r.note){const s=r.anchor.quotedText,i=t.text;tn(700).then(()=>{const o=J.find(l=>l.id===n);o&&(o.messages.push({who:"ai",html:Ho(i,s)}),Y())})}return{ok:!0}},updateComment:async(e,n,t)=>{const r=J.find(s=>s.id===n);if(!r)throw new Error("unknown comment");if(r.type==="expansion"){if(t.open!==void 0&&(r.open=t.open),t.post!==void 0||t.draft!==void 0||t.reply!==void 0)throw new Error(`annotation ${n} is not a thread`);return Y(),{ok:!0}}if(r.type!=="thread")throw new Error("unknown comment");return t.post!==void 0&&(r.post=t.post,t.post&&(r.open=!0)),t.draft===null?delete r.draft:t.draft!==void 0&&(r.draft=t.draft),t.open!==void 0&&(r.open=t.open),t.reply===null?delete r.reply:t.reply!==void 0&&(r.reply=t.reply),Y(),{ok:!0}},deleteComment:async(e,n)=>{const t=J.findIndex(r=>r.id===n);if(t<0)throw new Error("unknown comment");return J.splice(t,1),Y(),{ok:!0}},updateDescription:async(e,n)=>(ge={...ge,pendingHtml:n.html,pendingMarkdown:B0(n.html)},Uo(),{ok:!0,changed:!0}),revertDescription:async()=>{const{pendingHtml:e,pendingMarkdown:n,...t}=ge;return ge=t,Uo(),{ok:!0}},submit:async(e,n)=>{const t=nu();if(n!=null&&n.dryRun)return{posted:!1,commentCount:0,descriptionUpdated:!1,preview:t};const r=Date.now();for(const i of t.comments){const o=J.find(l=>l.id===i.threadId);o&&o.type==="thread"&&(o.postedAt=r,o.postedUrl="https://github.com/urllib3/urllib3/pull/5020#discussion_r-mock")}const s=ge.pendingHtml!==void 0;if(s){ge={...ge,html:ge.pendingHtml??ge.html,baseMarkdown:ge.pendingMarkdown};const{pendingHtml:i,pendingMarkdown:o,...l}=ge;ge=l}return Y(),Uo(),{posted:!0,commentCount:t.comments.length,descriptionUpdated:s,reviewUrl:"https://github.com/urllib3/urllib3/pull/5020#pullrequestreview-mock"}},submitPreview:async()=>({preview:nu()}),prComments:async()=>(M0(),{comments:ac}),viewer:async()=>({login:"you"}),settings:async()=>Jd(),saveSettings:async e=>{const n={...Jd(),...e};try{localStorage.setItem(dh,JSON.stringify(e))}catch{}return n},models:async e=>{const t={claude:["mock-main","mock-small","mock-opus"],codex:["mock-second","mock-mini"]}[e];if(!t)throw new Error(`GET /api/models?provider=${e}: 404 {"error":"no models for provider \\"${e}\\": adapter not installed or not logged in"}`);return{provider:e,models:t}},prompts:async e=>{const n=tu;return e?{templates:n,expanded:tu.map(t=>I0(t.name))}:{templates:n}},jobs:async e=>({jobs:e?mn.filter(n=>n.reviewId===e):[...mn]}),job:async e=>{const n=mn.find(t=>t.id===e);if(!n)throw new Error(`GET /api/jobs/${e}: 404 {"error":"unknown job"}`);return{job:n}},jobPrompt:async e=>{const n=mn.find(t=>t.id===e);if(!n)throw new Error(`GET /api/jobs/${e}/prompt: 404 {"error":"unknown job"}`);if(n.promptSnapshot===void 0)throw new Error(`GET /api/jobs/${e}/prompt: 404 {"error":"no prompt snapshot for job"}`);return{jobId:n.id,promptSnapshot:n.promptSnapshot}},cancelJob:async e=>{const n=mn.find(r=>r.id===e);if(!n)throw new Error(`POST /api/jobs/${e}/cancel: 404 {"error":"unknown job"}`);const t={...n,state:"cancelled"};return mn=mn.map(r=>r.id===e?t:r),{job:t}},setJobPriority:async(e,n)=>{const t=mn.find(s=>s.id===e);if(!t)throw new Error(`PATCH /api/jobs/${e}: 404 {"error":"unknown job"}`);const r={...t,priority:n};return mn=mn.map(s=>s.id===e?r:s),{job:r}},contributions:async e=>({contributions:e==="demo"?[...rn]:[]}),deleteContribution:async(e,n)=>{if(!rn.some(t=>t.id===n))throw new Error(`DELETE /api/reviews/demo/contributions/${n}: 404`);return rn=rn.filter(t=>t.id!==n),zo(),{ok:!0,deletedId:n}},acceptContribution:async(e,n)=>{const t=rn.find(c=>c.id===n);if(!t)throw new Error(`POST /api/reviews/demo/contributions/${n}/accept: 404`);const r=t.items.find(c=>c.kind==="correction");if(t.status!=="pending"||!(r!=null&&r.target))throw new Error(`POST /api/reviews/demo/contributions/${n}/accept: 409 {"error":"not a pending correction"}`);const s=r.target??"",i=s.startsWith("card:")?s.slice(5).split("#")[0]:"central",o=ch(i);let l=2;return(o==null?void 0:o.kind)==="page"&&(o.card.undoStack.push({blocks:JSON.parse(JSON.stringify(o.card.blocks)),level:o.card.level}),o.card.revision+=1,l=o.card.revision,Ue()),rn=rn.map(c=>c.id===n?{...c,status:"accepted"}:c),zo(),{ok:!0,acceptedId:n,cardId:i,revision:l}},dismissContribution:async(e,n)=>{const t=rn.find(r=>r.id===n);if(!t)throw new Error(`POST /api/reviews/demo/contributions/${n}/dismiss: 404`);if(t.status!=="pending")throw new Error(`POST /api/reviews/demo/contributions/${n}/dismiss: 409 {"error":"not a pending correction"}`);return rn=rn.map(r=>r.id===n?{...r,status:"dismissed"}:r),zo(),{ok:!0,dismissedId:n}}},tu=[{name:"instructions",role:"system",tier:"main",variables:[],template:`You are helping a person read and review a code change.
Link code as [[diff:file:line]] tokens.`},{name:"reader",role:"user",tier:"main",variables:["source","diff_inline","repo_path"],template:`You are the reader: explore the change.

## Source under review

{{source}}

## Diff

{{diff_inline}}

The branch is checked out at \`{{repo_path}}\`.`},{name:"base_pack",role:"user",tier:"main",variables:["source","diff_inline","pinned_code","guide","concepts","hunk_summaries"],template:`Base context pack.

{{source}}

{{diff_inline}}

{{pinned_code}}

{{guide}}

{{concepts}}

{{hunk_summaries}}`},{name:"explain",role:"user",tier:"main",variables:["anchor","card","thread","change_list","message"],template:`Explain the quoted text.

Quote: {{anchor.quote}}

Card:
{{card}}

Thread:
{{thread}}

Changes:
{{change_list}}

Message: {{message}}`}];function I0(e){const n=e==="instructions"?[{layer:"L0",label:"instructions",text:"You are helping a person read and review a code change.",cached:!1}]:[{layer:"L0",label:"instructions",text:"You are helping a person read and review a code change.",cached:!0},{layer:"L1",label:"source",text:`PR #5020 on urllib3/urllib3
Diff: 8 hunks, +42 −18`,cached:!0},{layer:"L1b",label:"pinned",text:"(no pinned excerpts)",cached:!0},{layer:"L2",label:"guide",text:`### The central change [[card:central]]

Unfold obsolete folded values.`,cached:!0},{layer:"L3",label:"log",text:"(log is empty)",cached:!0},{layer:"L4",label:e,text:e==="explain"?"(no text selected — open this template from Explain/Ask/Note)":`Task for ${e}.`,cached:!1}],t=[];let r=0;const s=n.map(i=>{const o=Math.max(1,Math.ceil(i.text.length/4));i.cached&&(r+=o);const l=i.cached?"cached:yes":"cached:no";return t.push(`<!-- layer:${i.layer} label:${i.label} tokens:${o} ${l} -->
${i.text}
<!-- /layer:${i.layer} -->
`),{layer:i.layer,tokens:o}});return{name:e,expanded:t.join(`
`),layers:s,cachedTokens:r}}const Wo={},Ya="unvibe_token",O0="__unvibe_token";function H0(){const e=new URLSearchParams(window.location.search),n=e.get("token");if(n){localStorage.setItem(Ya,n),document.cookie=`${O0}=${encodeURIComponent(n)}; SameSite=Lax; path=/`,e.delete("token");const t=e.toString(),r=window.location.pathname+(t?`?${t}`:"")+window.location.hash;return window.history.replaceState(null,"",r),n}return localStorage.getItem(Ya)}function lc(){return localStorage.getItem(Ya)}function V(e){const n=e instanceof Error?e.message:String(e);if(/failed to fetch|networkerror|load failed|offline/i.test(n))return"you're offline — try again when connected";const t=n.match(/^[A-Z]+ \/\S+: (\d{3})?\s?([\s\S]*)$/),r=((t==null?void 0:t[2])??n).trim();try{const s=JSON.parse(r);if(typeof s.error=="string"&&s.error.trim()!=="")return s.error.trim().slice(0,220)}catch{}switch(t==null?void 0:t[1]){case"401":return"the service refused the token — reload the page";case"404":return"not found — it may have been removed";case"409":return r.slice(0,220)||"conflicting change — refresh and try again";case"500":case"502":return"the service couldn't reach the repo or the agent — try again";default:return r.slice(0,220)||"something went wrong — try again"}}async function Qe(e,n){const t=lc(),r=(n==null?void 0:n.body)!==void 0,s=await fetch(e,{...n,headers:{...r?{"content-type":"application/json"}:{},...t?{authorization:`Bearer ${t}`}:{},...n==null?void 0:n.headers}});if(s.status===401)throw new Error("unauthorized: missing or invalid token");if(!s.ok){const i=await s.text().catch(()=>"");throw new Error(`${(n==null?void 0:n.method)??"GET"} ${e}: ${s.status} ${i}`)}return await s.json()}async function z0(e,n){const t=lc(),r=await fetch(e,{...n,headers:{...t?{authorization:`Bearer ${t}`}:{},...n==null?void 0:n.headers}});if(r.status===401)throw new Error("unauthorized: missing or invalid token");if(!r.ok){const s=await r.text().catch(()=>"");throw new Error(`GET ${e}: ${r.status} ${s}`)}return r.text()}async function U0(e,n,t){const r=`/api/reviews/${encodeURIComponent(e)}/diagrams/${encodeURIComponent(n)}?theme=${t}`;try{return await z0(r)}catch(s){if(s instanceof Error){const i=s.message.match(/: 409 ([\s\S]*)$/);if(i)try{const o=JSON.parse(i[1]);if(o.status==="unavailable"||o.status==="error")throw new Bi(o.status,o.error)}catch(o){if(o instanceof Bi)throw o}}throw s}}const Be=e=>Qe(e),Ln=(e,n)=>Qe(e,{method:"POST",body:n===void 0?void 0:JSON.stringify(n)}),W0=typeof import.meta<"u"&&(Wo==null?void 0:Wo.VITE_MOCK)==="1",V0={health:()=>fetch("/api/health").then(e=>e.json()),repos:()=>Be("/api/repos"),addRepo:e=>Qe("/api/repos",{method:"POST",body:JSON.stringify(e)}),repoChanges:(e,n)=>Be(`/api/repos/${encodeURIComponent(e)}/changes${n?`?filter=${n}`:""}`),createReview:e=>Ln("/api/reviews",e),reviews:()=>Be("/api/reviews"),deleteReview:e=>Qe(`/api/reviews/${encodeURIComponent(e)}`,{method:"DELETE"}),readiness:e=>Be(`/api/readiness${e?"?force=1":""}`),review:(e,n)=>Be(`/api/reviews/${encodeURIComponent(e)}${n!==void 0?`?version=${n}`:""}`),refresh:e=>Ln(`/api/reviews/${encodeURIComponent(e)}/refresh`),update:e=>Ln(`/api/reviews/${encodeURIComponent(e)}/update`),action:(e,n)=>Ln(`/api/reviews/${encodeURIComponent(e)}/actions`,n),updateHunk:(e,n,t)=>Qe(`/api/reviews/${encodeURIComponent(e)}/hunks/${encodeURIComponent(n)}`,{method:"PATCH",body:JSON.stringify(t)}),summarizeHunk:(e,n)=>Ln(`/api/reviews/${encodeURIComponent(e)}/hunks/${encodeURIComponent(n)}/summarize`),createComment:(e,n)=>Qe(`/api/reviews/${encodeURIComponent(e)}/comments`,{method:"POST",body:JSON.stringify(n)}),replyComment:(e,n,t)=>Ln(`/api/reviews/${encodeURIComponent(e)}/comments/${encodeURIComponent(n)}/replies`,t),updateComment:(e,n,t)=>Qe(`/api/reviews/${encodeURIComponent(e)}/comments/${encodeURIComponent(n)}`,{method:"PATCH",body:JSON.stringify(t)}),deleteComment:(e,n)=>Qe(`/api/reviews/${encodeURIComponent(e)}/comments/${encodeURIComponent(n)}`,{method:"DELETE"}),updateDescription:(e,n)=>Qe(`/api/reviews/${encodeURIComponent(e)}/description`,{method:"PUT",body:JSON.stringify(n)}),revertDescription:e=>Qe(`/api/reviews/${encodeURIComponent(e)}/description`,{method:"DELETE"}),submit:(e,n)=>Ln(`/api/reviews/${encodeURIComponent(e)}/submit`,n),submitPreview:e=>Be(`/api/reviews/${encodeURIComponent(e)}/submit/preview`),prComments:e=>Be(`/api/reviews/${encodeURIComponent(e)}/pr-comments`),viewer:()=>Be("/api/viewer"),settings:()=>Be("/api/settings"),saveSettings:e=>Qe("/api/settings",{method:"PUT",body:JSON.stringify(e)}),models:e=>Be(`/api/models?provider=${encodeURIComponent(e)}`),prompts:e=>Be(`/api/prompts${e?`?review=${encodeURIComponent(e)}`:""}`),jobs:e=>Be(`/api/jobs${e?`?review=${encodeURIComponent(e)}`:""}`),job:e=>Be(`/api/jobs/${encodeURIComponent(e)}`),jobPrompt:e=>Be(`/api/jobs/${encodeURIComponent(e)}/prompt`),cancelJob:e=>Ln(`/api/jobs/${encodeURIComponent(e)}/cancel`),setJobPriority:(e,n)=>Qe(`/api/jobs/${encodeURIComponent(e)}`,{method:"PATCH",body:JSON.stringify({priority:n})}),contributions:e=>Be(`/api/reviews/${encodeURIComponent(e)}/contributions`),diagramSvg:(e,n,t)=>U0(e,n,t),deleteContribution:(e,n)=>Qe(`/api/reviews/${encodeURIComponent(e)}/contributions/${encodeURIComponent(n)}`,{method:"DELETE"}),acceptContribution:(e,n)=>Ln(`/api/reviews/${encodeURIComponent(e)}/contributions/${encodeURIComponent(n)}/accept`),dismissContribution:(e,n)=>Ln(`/api/reviews/${encodeURIComponent(e)}/contributions/${encodeURIComponent(n)}/dismiss`)},T=W0?F0:V0,Vo={};function K0(e){const n=window.location.protocol==="https:"?"wss":"ws",t=lc(),r=new URLSearchParams({review:e,...t?{token:t}:{}});return`${n}://${window.location.host}/api/events?${r}`}function fh(e){var o;if(typeof import.meta<"u"&&(Vo==null?void 0:Vo.VITE_MOCK)==="1")return(o=e.onStatus)==null||o.call(e,!0),()=>{};let n=null,t=!1,r=0,s;const i=()=>{var l;t||((l=e.onStatus)==null||l.call(e,!1),n=new WebSocket(K0(e.reviewId)),n.onopen=()=>{var c;r=0,(c=e.onStatus)==null||c.call(e,!0)},n.onmessage=c=>{try{e.onEvent(JSON.parse(String(c.data)))}catch{}},n.onclose=()=>{var d;if((d=e.onStatus)==null||d.call(e,!1),t)return;const c=Math.min(1e4,(e.baseDelayMs??500)*2**r++);s=window.setTimeout(i,c)},n.onerror=()=>n==null?void 0:n.close())};return i(),()=>{t=!0,window.clearTimeout(s),n==null||n.close()}}let Xr=null;function F(e){Xr==null||Xr(e)}function _0(){const[e,n]=h.useState(null),t=h.useRef(void 0);return h.useEffect(()=>(Xr=r=>{n(r),window.clearTimeout(t.current),t.current=window.setTimeout(()=>n(null),2600)},()=>{Xr=null,window.clearTimeout(t.current)}),[]),a.jsx("div",{id:"toast",role:"status",hidden:e===null,children:e})}const Xa=e=>e.replace(/<[^>]+>/g," ");function G0(e){return e.cards.filter(n=>!n.pending)}function cc(e){const n=G0(e);return n.length>0&&n.every(t=>t.read)}function to(e,n){return n==="simple"?e.simple??e.standard:n==="deep"?e.deep??e.standard:e.standard}function dc(e){var r;const n=e.blocks.find(s=>s.type==="paragraph"||s.type==="list"||s.type==="code");let t="";return n?(n.type==="paragraph"?t=to(n.text,e.level):n.type==="list"?t=((r=n.items[0])==null?void 0:r.html)??"":t=n.code,Xa(t).replace(/\s+/g," ").trim()):t}function q0(e){for(const n of e.cards)for(const t of n.blocks){if(t.type==="paragraph"){const r=Xa(to(t.text,n.level)).replace(/\s+/g," ").trim();if(r)return r}if(t.type==="code"){const r=Xa(t.code).replace(/\s+/g," ").trim();if(r)return r}}return""}function Q0(e){for(const n of e.cards)if(!n.pending){for(const t of n.blocks)if(t.type==="paragraph")return to(t.text,n.level)}return null}const ru=/data-(?:node|link)="([^"]+)"/g;function Z0(e){return e?(ru.lastIndex=0,[...e.matchAll(ru)].map(n=>n[1])):[]}function uc(e,n){if(e.startsWith("page:")){const t=e.slice(5);return n(t)?t:null}if(e.startsWith("concept:")){const t=ph(n,e.slice(8));return t?t.id:null}return n(e)?e:null}function ph(e,n){return e(`c-${n}`)??e(n)}function Y0(e,n){const t=new Set,r=o=>{for(const l of Z0(o)){const c=uc(l,n);c&&t.add(c)}},s=o=>{o.type==="paragraph"?(r(o.text.standard),r(o.text.simple),r(o.text.deep)):o.type==="list"?o.items.forEach(l=>r(l.html)):o.type==="finding-link"?t.add(o.pageId):o.type==="aside"&&o.inner.forEach(s)};e.cards.forEach(o=>o.blocks.forEach(s)),t.delete(e.id);const i=[];for(const o of t){const l=n(o);l&&i.push(l)}return i}function X0(e,n){return n?n.filter(t=>t.parent===e.id&&t.kind==="opened-expansion"):[]}function J0(e,n,t){const r=e.cards.filter(c=>!("divider"in c)).map(c=>{var d;return{kind:"card",id:c.id,title:c.title||((d=c.pending)==null?void 0:d.label)||dc(c).slice(0,70),read:c.read}}),s=Y0(e,n),i=t?X0(e,t):[],o=new Set(s.map(c=>c.id));for(const c of i)o.has(c.id)||(s.push(c),o.add(c.id));const l=s.map(c=>({kind:"page",id:c.id,title:c.title,read:cc(c)}));return{cards:r,links:l}}function $0(e,n){const t=new Map(n.map(s=>[s.id,s])),r=s=>t.get(s);return e.replace(/<a class="cx" data-(node|link)="([^"]+)">/g,(s,i,o)=>{const l=uc(o,r)??(t.has(o)?o:null);if(l){const c=t.get(l);if(c&&cc(c))return`<a class="cx known" data-${i}="${o}">`}return s})}function e2(e){const n=e.indexOf("#");return n<0?{cardId:null,block:e}:{cardId:e.slice(0,n),block:e.slice(n+1)}}function xr(e,n,t){if(e===t)return!0;const r=e2(e);return r.cardId===n&&r.block===t}function hh(e,n){return e.find(t=>t.cardId===n&&(t.state==="running"||t.state==="queued"))}let ur=null;function n2(e){return ur=e,()=>{ur===e&&(ur=null)}}function t2(e,n){ur==null||ur(e,n)}function r2(e,n,t){return e.filter(r=>r.type==="thread"&&r.anchor.host.kind==="block"&&xr(r.anchor.host.blockId,n,t))}function s2(e,n){if(!n)return null;const r=e.join("").indexOf(n);if(r<0)return null;const s=r+n.length,i=[];let o=0;for(let l=0;l<e.length;l++){const c=e[l],d=o,u=o+c.length;o=u;const f=Math.max(r,d),p=Math.min(s,u);if(f<p&&i.push({node:l,start:f-d,end:p-d}),u>=s)break}return i.length>0?i:null}function i2(e){var r;const n=[],t=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);for(let s=t.nextNode();s;s=t.nextNode()){const i=s;(r=i.parentElement)!=null&&r.closest(".lo")||n.push(i)}return n}function fc(e,n,t){if(!n)return 0;const r=t();c2(e,r),typeof e.normalize=="function"&&e.normalize();const s=i2(e);if(s.length===0)return 0;const i=s2(s.map(l=>l.data),n);if(!i)return 0;let o=0;for(let l=i.length-1;l>=0;l--){const c=i[l],d=s[c.node];try{const u=document.createRange();u.setStart(d,c.start),u.setEnd(d,c.end),u.surroundContents(t()),o++}catch{}}return o}function gs(e,n,t,r){if(!t)return!1;const s=e.querySelectorAll(`[data-top="${CSS.escape(n)}"]`);for(const i of s)if(fc(i,t,r)>0)return!0;return!1}function Cs(e,n){let t=[];try{t=[...e.querySelectorAll(n)]}catch{return}for(let r=t.length-1;r>=0;r--)mh(t[r])}function Ss(e,n){const t=o2(e);try{return n()}finally{a2(e,t)}}function o2(e){const n={anchor:null,focus:null,active:null,inputStart:null,inputEnd:null};try{const t=typeof document<"u"?document.activeElement:null;if(t&&t instanceof Element&&(n.active=t,t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement))try{n.inputStart=t.selectionStart,n.inputEnd=t.selectionEnd}catch{}const r=typeof window<"u"&&window.getSelection?window.getSelection():null;if(!r||r.rangeCount===0)return n;const s=r.anchorNode,i=r.focusNode;return!s||!i||!e.contains(s)||!e.contains(i)||(n.anchor=su(e,s,r.anchorOffset),n.focus=su(e,i,r.focusOffset)),n}catch{return n}}function su(e,n,t){try{const r=document.createRange();return r.selectNodeContents(e),r.setEnd(n,t),r.toString().length}catch{return null}}function iu(e,n){try{const t=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let r=0;for(let s=t.nextNode();s;s=t.nextNode()){const i=s,o=r+i.data.length;if(n<=o)return{node:i,at:Math.min(n-r,i.data.length)};r=o}return null}catch{return null}}function a2(e,n){try{if(n.anchor!==null&&n.focus!==null){const r=iu(e,n.anchor),s=iu(e,n.focus),i=window.getSelection?window.getSelection():null;if(r&&s&&i){const o=document.createRange();o.setStart(r.node,r.at),o.setEnd(s.node,s.at),i.removeAllRanges(),i.addRange(o)}}const t=n.active;if(t&&t.isConnected&&document.activeElement!==t){if(t instanceof HTMLElement&&typeof t.focus=="function")try{t.focus({preventScroll:!0})}catch{t.focus()}if((t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement)&&n.inputStart!==null&&n.inputEnd!==null)try{t.setSelectionRange(n.inputStart,n.inputEnd)}catch{}}else if(t&&t.isConnected&&(t instanceof HTMLInputElement||t instanceof HTMLTextAreaElement)&&n.inputStart!==null&&n.inputEnd!==null&&document.activeElement===t)try{t.setSelectionRange(n.inputStart,n.inputEnd)}catch{}}catch{}}function l2(e,n){if(e.tagName!==n.tagName)return!1;const t=n.dataset??{},r=e.dataset??{},s=Object.keys(t),i=Object.keys(r);return s.length===0&&i.length===0?e.className===n.className:s.length!==i.length?!1:s.every(o=>r[o]===t[o])}function mh(e){const n=e.parentNode;if(n){for(;e.firstChild;)n.insertBefore(e.firstChild,e);n.removeChild(e);try{n.normalize()}catch{}}}function c2(e,n){let t=[];try{t=[...e.querySelectorAll("*")]}catch{return}for(let r=t.length-1;r>=0;r--){const s=t[r];!s.parentNode||!e.contains(s)||l2(s,n)&&mh(s)}}function ro(){const e=new URLSearchParams(window.location.search).get("version");if(e===null)return;const n=Number(e);return Number.isSafeInteger(n)&&n>=1?n:void 0}function Cr(){const e=D(t=>t.snapshot),n=ro();return!e||n===void 0?!1:n!==e.review.currentVersion}function mt(){const e=D.getState().snapshot;if(!e)return!1;const n=new URLSearchParams(window.location.search).get("version");if(n===null)return!1;const t=Number(n);return!Number.isSafeInteger(t)||t<1?!1:t!==e.review.currentVersion}const ou=/[\p{L}\p{N}_'’]/u;function Gs(e){return e?(ou.lastIndex=0,ou.test(e)):!1}function au(e){return e!==void 0&&/\s/.test(e)}function Ko(e,n,t){let r=Math.max(0,Math.min(e.length,n)),s=Math.max(0,Math.min(e.length,t));for(s<r&&([r,s]=[s,r]);r<e.length&&au(e[r]);)r++;for(;s>0&&au(e[s-1]);)s--;for(;r>0&&Gs(e[r-1])&&Gs(e[r]??"");)r--;for(;s<e.length&&Gs(e[s])&&Gs(e[s-1]??"");)s++;return[r,s]}function d2(e){return e.trim().replace(/\s+/g," ")}function u2(e){return e.length>=2&&e.length<=300}function f2(e){if(!e.startsWith("L-"))return null;const n=e.slice(2),t=n.lastIndexOf("-");if(t<=0)return null;const r=n.slice(0,t),s=Number(n.slice(t+1));return!r||!Number.isSafeInteger(s)||s<1?null:{fileKey:r,line:s}}const Ot="unvibe:new-thread";function p2(e){window.dispatchEvent(new CustomEvent(Ot,{detail:e}))}function h2(e){return e?e.nodeType===1?e:e.parentElement??null:null}function m2(e){var l,c;const n=e.closest("#page [data-top], #right [data-top]");if(n){const d=n.dataset.top??"";return d?n.closest("#right .desc")?{anchor:{where:"description",paragraphId:n.dataset.top??n.id??d}}:{anchor:{where:"block",blockId:d}}:null}const t=e.closest("#right .desc [id]");if(t&&e.closest("#right .desc"))return{anchor:{where:"description",paragraphId:t.id}};const r=e.closest("#right table.diff td.c");if(!r)return null;const s=r.closest("tr");let i=s;for(;i&&!((l=i.id)!=null&&l.startsWith("L-"));)i=i.nextElementSibling;if(!i)for(i=s;i&&!((c=i.id)!=null&&c.startsWith("L-"));)i=i.previousElementSibling;if(!(i!=null&&i.id))return null;const o=f2(i.id);return o?{anchor:{where:"diff-line",fileKey:o.fileKey,line:o.line}}:null}function A2(e){if(!e.rangeCount||e.isCollapsed)return;const n=e.getRangeAt(0),{startContainer:t,startOffset:r,endContainer:s,endOffset:i}=n;try{if(t===s&&t.nodeType===3){const l=t.data,[c,d]=Ko(l,r,i);if(c===r&&d===i||(n.setStart(t,c),n.setEnd(s,d),n.collapsed))return;e.removeAllRanges(),e.addRange(n);return}const o=n.cloneRange();if(t.nodeType===3){const l=t.data,[c]=Ko(l,r,l.length);o.setStart(t,c)}if(s.nodeType===3){const l=s.data,[,c]=Ko(l,0,i);o.setEnd(s,c)}if(o.collapsed)return;e.removeAllRanges(),e.addRange(o)}catch{}}function g2(){const[e,n]=h.useState(null),t=Cr(),r=h.useRef(null),s=h.useRef(null);s.current=e,h.useEffect(()=>{const c=()=>r.current,d=()=>n(null),u=x=>{var g,m,k,b,y,C;if((m=(g=x.target)==null?void 0:g.closest)!=null&&m.call(g,"#selbar"))return;if(!((b=(k=x.target)==null?void 0:k.closest)==null?void 0:b.call(k,"#page, #right .desc:not(.editing), #right table.diff"))||(C=(y=x.target)==null?void 0:y.closest)!=null&&C.call(y,"button, a, input, textarea")||mt()){d();return}window.setTimeout(()=>{const S=window.getSelection();if(!S||S.rangeCount===0||S.isCollapsed){d();return}A2(S);const N=d2(S.toString()),M=S.anchorNode,R=m2(h2(M)??document.body);if(!N||!u2(N)||!R){d();return}n({quote:N,anchor:R.anchor}),window.setTimeout(()=>{const O=c();if(!O||S.rangeCount===0)return;const _=S.getRangeAt(0).getBoundingClientRect();O.style.left=`${Math.max(8,Math.min(window.innerWidth-O.offsetWidth-8,_.left+_.width/2-O.offsetWidth/2))}px`;const le=_.top-O.offsetHeight-8<56?_.bottom+8:_.top-O.offsetHeight-8;O.style.top=`${Math.max(8,Math.min(window.innerHeight-O.offsetHeight-8,le))}px`},0)},0)},f=()=>{var x;(x=window.getSelection())!=null&&x.isCollapsed&&d()},p=x=>{x.key==="Escape"&&d()},A=()=>d(),v=x=>{var w,g;(g=(w=x.target)==null?void 0:w.closest)!=null&&g.call(w,"#selbar")||d()};return document.addEventListener("mouseup",u),document.addEventListener("selectionchange",f),document.addEventListener("keydown",p),document.addEventListener("scroll",A,!0),document.addEventListener("wheel",A,{capture:!0,passive:!0}),document.addEventListener("pointerdown",v,!0),window.addEventListener("blur",d),window.addEventListener("resize",d),()=>{document.removeEventListener("mouseup",u),document.removeEventListener("selectionchange",f),document.removeEventListener("keydown",p),document.removeEventListener("scroll",A,!0),document.removeEventListener("wheel",A,!0),document.removeEventListener("pointerdown",v,!0),window.removeEventListener("blur",d),window.removeEventListener("resize",d)}},[]);const i=()=>{var c;n(null),(c=window.getSelection())==null||c.removeAllRanges()},o=()=>{var u;const c=s.current;if(!c)return;const d=(u=D.getState().snapshot)==null?void 0:u.review.id;if(i(),!d){F("The review hasn't loaded yet.");return}T.action(d,{kind:"explain",quote:c.quote,anchor:c.anchor}).then(f=>{f.accepted||F("Couldn't create the explanation.")}).catch(f=>{const p=f instanceof Error?f.message:String(f);/no agent configured/i.test(p)?F("No agent configured — set up Claude or Codex in Settings → Models to generate explanations."):F(`Explain failed: ${V(f)}`)})},l=c=>{const d=s.current;d&&(i(),p2({anchor:d.anchor,quote:d.quote,note:c}))};return a.jsxs("div",{id:"selbar",ref:r,hidden:e===null||t,children:[a.jsx("button",{type:"button","data-act":"explain",onClick:o,children:"Explain"}),a.jsx("span",{className:"sep"}),a.jsx("button",{type:"button","data-act":"ask",onClick:()=>l(!1),children:"Ask…"}),a.jsx("button",{type:"button","data-act":"note",onClick:()=>l(!0),children:"Note"})]})}const Ah=6e4,pc=new Map;function Ja(e,n=Date.now()){pc.set(e,n)}function v2(e,n=Date.now()){const t=pc.get(e);return t===void 0?!1:n-t<Ah}function x2(e,n){const[,t]=h.useState(0);h.useEffect(()=>{if(!n)return;const r=pc.get(e)??Date.now(),s=Math.max(0,Ah-(Date.now()-r)),i=window.setTimeout(()=>t(o=>o+1),s+50);return()=>window.clearTimeout(i)},[e,n])}function Di({reviewId:e,anchor:n,quote:t,note:r,onDiscard:s,onCreated:i}){const[o,l]=h.useState(""),[c,d]=h.useState(!1),u=()=>{const f=o.trim();if(!(!f||c)){if(d(!0),!r){T.action(e,{kind:"ask",anchor:n,quote:t,message:f}).then(p=>{const A=p.threadId??p.annotationId;if(!A)throw new Error("ask returned no thread");Ja(A),i(A)}).catch(p=>{F(`Couldn't ask the agent: ${V(p)}`)}).finally(()=>d(!1));return}T.createComment(e,{anchor:n,quote:t,note:r,text:f}).then(p=>{i(p.id)}).catch(p=>{F(`Couldn't create the comment: ${V(p)}`)}).finally(()=>d(!1))}};return a.jsxs("div",{className:"ithread","data-pending-thread":"true",children:[a.jsx("div",{className:"thd",children:a.jsx("span",{className:"mq",children:t?`“${t}”`:"New comment"})}),a.jsxs("div",{className:"composer",children:[a.jsx("textarea",{rows:3,autoFocus:!0,placeholder:r?"Write a note…":"Ask the agent, or draft a review comment…","aria-label":"New comment",value:o,onChange:f=>l(f.target.value),onKeyDown:f=>{f.key==="Enter"&&(f.metaKey||f.ctrlKey)&&(f.preventDefault(),u())}}),a.jsxs("div",{className:"row",children:[a.jsx("button",{className:"btn ghost",type:"button",onClick:s,children:"Discard"}),a.jsx("button",{className:"btn",type:"button",disabled:c||o.trim()==="",onClick:u,children:r?"Save":"Ask"})]})]})]})}const k2={down:a.jsx("path",{d:"M4 6l4 4 4-4"}),right:a.jsx("path",{d:"M6 4l4 4-4 4"}),check:a.jsxs(a.Fragment,{children:[a.jsx("circle",{cx:"8",cy:"8",r:"6"}),a.jsx("path",{d:"M5.5 8.2l1.8 1.8 3.3-3.6"})]}),spark:a.jsx("path",{d:"M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z"}),note:a.jsx("path",{d:"M3 13l.8-3L10.5 3.3l2.2 2.2L6 12.2z"}),trash:a.jsx("path",{d:"M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"}),undo:a.jsxs(a.Fragment,{children:[a.jsx("path",{d:"M5.5 3.5L2.5 6.5l3 3"}),a.jsx("path",{d:"M2.5 6.5H10a3.5 3.5 0 010 7H7.5"})]}),bulb:a.jsx("path",{d:"M6 13.5h4M6.3 11.2h3.4M8 2.2a4 4 0 00-2.5 7.1v1.9h5V9.3A4 4 0 008 2.2z"}),diagram:a.jsxs(a.Fragment,{children:[a.jsx("rect",{x:"2",y:"2.5",width:"5",height:"4",rx:"1"}),a.jsx("rect",{x:"9",y:"9.5",width:"5",height:"4",rx:"1"}),a.jsx("path",{d:"M4.5 6.5v3.5h4.5"})]}),comment:a.jsx("path",{d:"M2.5 3h11v7.5h-6.2L4.5 13v-2.5h-2z"}),code:a.jsx("path",{d:"M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"}),x:a.jsx("path",{d:"M4.5 4.5l7 7M11.5 4.5l-7 7"}),open:a.jsx("path",{d:"M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4"}),send:a.jsxs(a.Fragment,{children:[a.jsx("path",{d:"M2.5 7.5L13.5 2.5 9 13.5 7.5 9z"}),a.jsx("path",{d:"M7.5 9L13.5 2.5"})]}),bookmark:a.jsx("path",{d:"M4.5 2.5h7v11L8 10.5l-3.5 3z"}),reply:a.jsxs(a.Fragment,{children:[a.jsx("path",{d:"M6.5 4L3 7.5 6.5 11"}),a.jsx("path",{d:"M3 7.5h6.5a3.5 3.5 0 013.5 3.5v1"})]}),hide:a.jsx("path",{d:"M4 10l4-4 4 4"})};function q({name:e}){return a.jsx("svg",{className:"ic",viewBox:"0 0 16 16","aria-hidden":"true",children:k2[e]})}function Fi(e,n,t={}){const r=e.files.find(o=>o.fileKey===n);if(r)return{fileKey:r.fileKey,path:r.path};const s=t[n];if(s){const o=e.files.find(l=>l.fileKey===s);if(o)return{fileKey:o.fileKey,path:o.path}}const i=e.files.find(o=>o.path===n);return i?{fileKey:i.fileKey,path:i.path}:null}function w2(e,n){var i,o;const t=(i=e.description)==null?void 0:i.html;if(!t)return null;const s=new DOMParser().parseFromString(t,"text/html").getElementById(n);return s?((o=s.textContent)==null?void 0:o.replace(/Restated →/g,"").replace(/\s+/g," ").trim().slice(0,200))??null:null}function lu(e,n,t,r,s){var c;const i=Fi(e,n,s);if(!i)return null;const o=new Map;for(const d of((c=e.files.find(u=>u.fileKey===i.fileKey))==null?void 0:c.hunks)??[])for(const u of d.lines)u.newLine!==void 0&&!o.has(u.newLine)&&o.set(u.newLine,u);const l=[];for(let d=t;d<=Math.min(r,t+3);d++){const u=o.get(d);u!==void 0&&l.push(u.text)}return l.length?l.join(`
`):null}function cu(e,n,t){const r=e.split("/").pop()??e,s=n===t?`${n}`:`${n}–${t}`;return`${r}:${s}`}function gh(e,n,t={}){const{target:r}=n,s=no(r);if(!s)return{target:r,label:r,snippet:"",unverified:n.unverified};if(s.kind==="desc")return{target:r,label:"PR description",snippet:w2(e,s.paragraph)??"",unverified:n.unverified};if(s.kind==="diff"){const i=Fi(e,s.fileKey,t),o=lu(e,s.fileKey,s.start,s.end,t)??"";return{target:r,label:i?cu(i.path,s.start,s.end):r,snippet:o,unverified:n.unverified}}if(s.kind==="code"){const i=Fi(e,s.path,t),o=lu(e,s.path,s.start,s.end,t)??"";return{target:r,label:i?cu(i.path,s.start,s.end):r,snippet:o,unverified:n.unverified}}return s.kind==="h"?{target:r,label:`hunk ${s.contentHash.slice(0,8)}`,snippet:"",unverified:n.unverified}:{target:r,label:r,snippet:"",unverified:n.unverified}}function $a(e,n,t={}){return n.map(r=>gh(e,r,t))}function y2(e,n,t={}){const r=no(n);if(!r||r.kind!=="diff")return n;const s=Fi(e,r.fileKey,t);if(!s||s.fileKey===r.fileKey)return n;const i=r.start===r.end?`${r.start}`:`${r.start}-${r.end}`,o=r.sha?`@${r.sha}`:"";return`diff:${s.fileKey}:${i}${o}`}function b2(e){const n={kids:new Map,files:[]};for(const s of e){const i=s.path.split("/").slice(0,-1);let o=n;for(const l of i){let c=o.kids.get(l);c||(c={kids:new Map,files:[]},o.kids.set(l,c)),o=c}o.files.push(s)}const t=[],r=(s,i,o,l)=>{for(;i&&s.kids.size===1&&s.files.length===0;){const[[d,u]]=[...s.kids.entries()];i+=`/${d}`,l+=`/${d}`,s=u}let c=o;i&&(t.push({type:"dir",path:l,label:i,depth:o}),c++);for(const[d,u]of s.kids)r(u,d,c,l?`${l}/${d}`:d);for(const d of s.files)t.push({type:"file",file:d,depth:c})};return r(n,"",0,""),t}function C2(e,n){const t=[];let r=[];const s=()=>{r.length>0&&(t.push({type:"hidden",indices:r}),r=[])};return e.forEach((i,o)=>{n(i,o)?r.push(o):(s(),t.push({type:"show",index:o}))}),s(),t}function S2(e){const n=[];let t=0;for(;t<e.length;){if(e[t].kind==="ctx"){n.push({kind:"ctx",line:e[t++]});continue}const r=[],s=[];for(;t<e.length&&e[t].kind==="del";)r.push(e[t++]);for(;t<e.length&&e[t].kind==="add";)s.push(e[t++]);const i=Math.max(r.length,s.length);for(let o=0;o<i;o++)n.push({kind:"pair",left:r[o],right:s[o]})}return n}function du(e,n){const t=n.query.toLowerCase();return e.filter(r=>n.cats.has(r.category)&&r.path.toLowerCase().includes(t)&&!(n.hideReviewed&&n.reviewedCount(r)===r.hunks.length))}function E2(e){return{added:e.hunks.reduce((n,t)=>n+t.added,0),removed:e.hunks.reduce((n,t)=>n+t.removed,0)}}function uu(e,n){const t=e.hunks.length;return n.length===1?`Hunk ${n[0]+1} of ${t}`:`Hunks ${n[0]+1}–${n[n.length-1]+1} of ${t}`}const j2=/^diff:([^:@]+)(?::(\d+)(?:-(\d+))?)?(?:@[0-9a-fA-F]{4,64})?$/;function vh(e){if(!e||e.length>1024)return null;const n=e.match(j2);if(!n||!n[1])return null;const t=n[2]!==void 0?Number(n[2]):void 0,r=n[3]!==void 0?Number(n[3]):t;return t!==void 0&&(!Number.isSafeInteger(t)||t<1)||r!==void 0&&(!Number.isSafeInteger(r)||r<t)?null:{fileKey:n[1],start:t,end:r}}function el(e,n,t){return n<=e.newEnd&&t>=e.newStart}function xh(e,n){for(const t of e){for(const r of t.citations??[])n.push(r.target);t.type==="aside"&&xh(t.inner,n)}}function N2(e,n,t){const r=[];for(const o of n)for(const l of o.cards??[])xh(l.blocks??[],r);const s=new Map(e.map(o=>[o.fileKey,o])),i=new Set;for(const o of r){const l=no(o);if(l){if(l.kind==="h")i.add(l.contentHash);else if(l.kind==="diff"){const c=s.get(l.fileKey);if(!c)continue;for(const d of c.hunks)el(d,l.start,l.end)&&i.add(d.contentHash)}}}return i}function fu(e,n){return!(!n.hideUninteresting||n.unhidden||n.cited||!e.hiddenReason||e.added+e.removed<=1)}function L2(e){switch(e){case"generated":return"Generated file; safe to skip.";case"docs / config":return"Docs or config changes; no code.";case"imports":return"Import-only changes.";default:return e??"Uninteresting changes."}}const Ht="unvibe:reveal-source",nl=new Set;let tl=null;function T2(e){return nl.add(e),()=>{nl.delete(e)}}function R2(e){const n=vh(e);if(!n)return!1;tl=e;for(const t of[...nl])t(e,n);return typeof window<"u"&&window.dispatchEvent(new CustomEvent(Ht,{detail:{ref:e}})),!0}function P2(){const e=tl;return tl=null,e}function M2(e){window.setTimeout(()=>{const n=document.getElementById(e);if(!n)return;const t=window.matchMedia("(prefers-reduced-motion: reduce)").matches;n.scrollIntoView({block:"center",behavior:t?"auto":"smooth"}),n.classList.add("hl"),window.setTimeout(()=>n.classList.remove("hl"),2600)},60)}function Cn(e){const n=D.getState().snapshot,t=n?y2(n,e):e;if(e.startsWith("desc:")){window.dispatchEvent(new CustomEvent(Ht,{detail:{ref:e}})),M2(e.slice(5).split("@")[0]);return}if(e.startsWith("diff:")||e.startsWith("h:")||e.startsWith("code:")){if(!n){F("The review hasn't loaded yet.");return}if(R2(t))return;F("Couldn't find the cited code in this version.");return}F("Couldn't open that citation target.")}const B2=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),D2=e=>B2(e).replace(/`([^`]+)`/g,"<code>$1</code>");function F2(e){const n=e.successor;if(!n)return null;const t=n.host;if(t.kind==="diff-line"){const r=t.endLine&&t.endLine!==t.line?`${t.line}-${t.endLine}`:`${t.line}`;return`diff:${t.fileKey}:${r}`}return t.kind==="description"?`desc:${t.paragraphId}`:null}function I2({citations:e}){const n=(e??[]).filter(r=>!r.unverified),t=(e??[]).filter(r=>r.unverified);return n.length===0&&t.length===0?null:a.jsxs("span",{className:"lo",children:[n.length>0&&a.jsxs("button",{className:"lk",type:"button","data-refs":n.map(r=>r.target).join("|"),"data-src":n[0].target,"aria-label":n.length>1?`${n.length} sources`:"Source","data-tip":"Show in source",onClick:()=>Cn(n[0].target),children:[a.jsx(q,{name:"code"}),n.length>1?n.length:""]}),t.map(r=>a.jsx("button",{className:"lk unverified",type:"button","data-refs":r.target,"data-src":r.target,"aria-label":"Unverified source","data-tip":"This citation could not be checked, so it is shown as unverified.",onClick:()=>Cn(r.target),children:a.jsx(q,{name:"code"})},r.target))]})}function O2(e,n){return n.anchor.quotedText?`“${n.anchor.quotedText}”`:n.anchor.host.kind==="diff-line"?`${e??n.anchor.host.fileKey}:${n.anchor.host.line}`:"Comment"}function Ii({reviewId:e,thread:n,readOnly:t}){var qe;const r=D(z=>z.snapshot),s=n.anchor.host,i=s.kind==="diff-line"?((qe=r==null?void 0:r.files.find(z=>z.fileKey===s.fileKey))==null?void 0:qe.path.split("/").pop())??null:null,o=n.messages,l=o.length===0,c=o[o.length-1],d=!n.note&&o.length>0&&(c==null?void 0:c.who)==="you",f=D(z=>z.streams)[n.id],p=n.working!==void 0&&n.working!==null&&n.working!=="",A=d&&!n.error&&(p||v2(n.id)),v=d&&!A&&!n.error;x2(n.id,A);const x=n.postedAt!==void 0,w=F2(n),[g,m]=h.useState(n.reply??""),[k,b]=h.useState(!1),y=h.useRef(void 0),C=h.useRef(n.id);C.current!==n.id&&(C.current=n.id,m(n.reply??"")),h.useEffect(()=>{n.reply!==void 0&&n.reply!==g&&m(n.reply)},[n.reply]);const S=h.useRef(g);S.current=g;const N=h.useRef(n.reply);N.current=n.reply,h.useEffect(()=>()=>{window.clearTimeout(y.current);const z=S.current;z!==(N.current??"")&&z.trim()!==""&&T.updateComment(e,n.id,{reply:z}).catch(()=>{})},[e,n.id]);const M=z=>{window.clearTimeout(y.current),y.current=window.setTimeout(()=>{T.updateComment(e,n.id,{reply:z}).catch(()=>{})},400)},R=()=>{if(window.clearTimeout(y.current),l&&g.trim()===""){T.deleteComment(e,n.id).catch(z=>{F(`Couldn't discard the comment: ${V(z)}`)});return}m(""),T.updateComment(e,n.id,{reply:null}).catch(z=>{F(`Couldn't clear the reply: ${V(z)}`)})},O=()=>{const z=g.trim();if(!z||k)return;b(!0);const B=!n.note;(B?T.action(e,{kind:"reply",threadId:n.id,message:z}):T.replyComment(e,n.id,{text:z})).then(()=>{m(""),B&&Ja(n.id)}).catch(W=>{F(`Couldn't send the reply: ${V(W)}`)}).finally(()=>b(!1))},_=()=>{k||(b(!0),T.action(e,{kind:"retry",threadId:n.id}).then(()=>{Ja(n.id)}).catch(z=>{F(`Couldn't retry the reply: ${V(z)}`)}).finally(()=>b(!1)))},ae=()=>{T.updateComment(e,n.id,{post:!n.post}).catch(z=>{F(`Couldn't mark the comment: ${V(z)}`)})},le=()=>{T.deleteComment(e,n.id).catch(z=>{F(`Couldn't delete the comment: ${V(z)}`)})},fn=()=>{T.updateComment(e,n.id,{open:!1}).catch(z=>{F(`Couldn't close the comment: ${V(z)}`)})};return a.jsxs("div",{className:"ithread",id:n.id,"data-thread":n.id,children:[a.jsxs("div",{className:"thd",children:[a.jsx("span",{className:"mq",children:O2(i,n)}),l?null:a.jsx("button",{className:"ib pr",type:"button","data-tip":t?"Viewing an older version · read-only":n.post?"Marked for the PR · click to unmark":"Mark for the PR","aria-label":n.post?"Marked for the PR · click to unmark":"Mark for the PR","aria-pressed":n.post,"data-post":n.id,disabled:t,onClick:ae,children:a.jsx(q,{name:"send"})}),a.jsx("button",{className:"ib",type:"button","data-tip":t?"Viewing an older version · read-only":"Delete","aria-label":"Delete","data-remove":n.id,disabled:t,onClick:le,children:a.jsx(q,{name:"trash"})}),l?null:a.jsx("button",{className:"ib",type:"button","data-tip":t?"Viewing an older version · read-only":"Close","aria-label":"Close","data-closethr":n.id,disabled:t,onClick:fn,children:a.jsx(q,{name:"x"})})]}),n.outdated?a.jsxs("div",{className:"pv outdated",children:[a.jsx("div",{className:"q",children:"Outdated · the code changed"}),n.originalSnippet?a.jsx("div",{className:"snip",children:n.originalSnippet.slice(0,200)}):null,w?a.jsx("button",{className:"cite",type:"button",onClick:()=>Cn(w),children:a.jsx("span",{className:"loc",children:"See the new code →"})}):null]}):null,o.map((z,B)=>a.jsxs("div",{className:"msg",children:[a.jsx("span",{className:`av ${z.who==="you"?"you":"ai"}`,children:z.who==="you"?"Me":"AI"}),a.jsxs("div",{children:[a.jsx("div",{className:"who",children:z.who==="you"?"You":z.suggested?"Agent · suggested comment":"Agent"}),a.jsx("p",{dangerouslySetInnerHTML:{__html:z.html??D2(z.text??"")}}),a.jsx(I2,{citations:z.citations})]})]},B)),A?a.jsxs("div",{className:"working",role:"status",children:[a.jsxs("span",{className:"dots","aria-hidden":"true",children:[a.jsx("i",{}),a.jsx("i",{}),a.jsx("i",{})]}),a.jsx("span",{children:n.working&&n.working!=="Reading…"?n.working:"Reading the diff and PR body…"}),f?a.jsx("span",{className:"stream",children:f.slice(-160)}):null]}):null,v?a.jsx("div",{className:"hint",role:"status",children:"Still waiting for the agent — its reply will appear here."}):null,n.error&&!t?a.jsxs("div",{className:"perr",role:"alert",children:[a.jsxs("span",{children:["Couldn't get an answer: ",V(n.error)]}),a.jsx("button",{className:"btn",type:"button","data-retry":n.id,onClick:_,children:"Retry"})]}):null,x?a.jsxs("div",{className:"hint",children:["Posted",n.postedUrl?a.jsxs(a.Fragment,{children:[" · ",a.jsx("a",{href:n.postedUrl,target:"_blank",rel:"noreferrer noopener",children:"view on GitHub"})]}):null]}):null,t?a.jsx("div",{className:"hint",children:"Viewing an older version · read-only"}):a.jsxs("div",{className:"composer",children:[a.jsx("textarea",{id:`ta-${n.id}`,rows:l?3:1,placeholder:l?n.note?"Write a note…":"Ask the agent, or draft a review comment…":"Reply…","aria-label":l?"New comment":"Reply",value:g,onChange:z=>{m(z.target.value),M(z.target.value)},onKeyDown:z=>{z.key==="Enter"&&(z.metaKey||z.ctrlKey)&&(z.preventDefault(),O())}}),a.jsxs("div",{className:"row",children:[a.jsx("button",{className:"btn ghost",type:"button","data-discard":n.id,"data-tip":l?"Discard this comment":"Clear the reply",onClick:R,children:"Discard"}),a.jsx("button",{className:"btn",type:"button","data-send":n.id,disabled:k||g.trim()==="",onClick:O,children:n.note?"Save":l?"Ask":"Reply"})]})]})]})}function H2(e){const n=document.createElement("mark");return n.className="anc",n.dataset.thr=e,n}function z2(e,n){for(const t of e.querySelectorAll(".lk.cm")){const s=(t.dataset.threads??"").split("|").filter(Boolean);if(!s.some(o=>n.has(o)))continue;const i=s.filter(o=>!n.has(o));if(i.length===0){const o=t.closest(".lo");t.remove(),o&&o.children.length===0&&o.remove()}else{t.dataset.threads=i.join("|");const o=t.lastChild;o&&(o.textContent=String(i.length))}}}function U2(){const e=D(t=>{var r;return(r=t.snapshot)==null?void 0:r.annotations}),n=D(t=>{var r;return(r=t.snapshot)==null?void 0:r.pages});return h.useEffect(()=>n2(t=>{var s;const r=(s=D.getState().snapshot)==null?void 0:s.review.id;if(r){if(mt()){F("Viewing an older version · read-only");return}T.updateComment(r,t,{open:!0}).catch(i=>{F(`Couldn't open the comment: ${V(i)}`)}),window.setTimeout(()=>{var i;(i=document.getElementById(t))==null||i.scrollIntoView({block:"nearest"})},60)}}),[]),h.useEffect(()=>{const t=document.getElementById("page");if(!t)return;const r=(e??[]).filter(o=>o.type==="thread"&&o.anchor.host.kind==="block"&&!!o.anchor.quotedText),s=new Set,i=window.setTimeout(()=>{Ss(t,()=>{Cs(t,"mark.anc[data-thr]");for(const o of r){const l=o.anchor.host;if(l.kind!=="block")continue;const c=l.blockId.indexOf("#"),d=c>=0?l.blockId.slice(c+1):l.blockId,u=[l.blockId,d];let f=!1;for(const p of u)if(gs(t,p,o.anchor.quotedText,()=>H2(o.id))){f=!0;break}f&&s.add(o.id)}z2(t,s)})},0);return()=>window.clearTimeout(i)},[e,n]),h.useEffect(()=>{const t=s=>{var u,f,p,A;const i=(f=(u=s.target)==null?void 0:u.closest)==null?void 0:f.call(u,"mark.anc[data-thr]");if(!i){const v=(A=(p=s.target)==null?void 0:p.closest)==null?void 0:A.call(p,"[data-cjump]");if(v){const x=v.dataset.cjump??"",w=D.getState().snapshot,g=w==null?void 0:w.review.id,m=w==null?void 0:w.annotations.find(k=>k.id===x);if(!g||!m||m.type!=="thread"||mt())return;m.open||T.updateComment(g,x,{open:!0}).catch(()=>{})}return}const o=i.dataset.thr??"",l=D.getState().snapshot,c=l==null?void 0:l.review.id,d=l==null?void 0:l.annotations.find(v=>v.id===o);if(!(!c||!d||d.type!=="thread")){if(mt()){F("Viewing an older version · read-only");return}T.updateComment(c,o,{open:!d.open}).catch(v=>{F(`Couldn't open the comment: ${v instanceof Error?v.message:String(v)}`)}),d.open||window.setTimeout(()=>{var v;(v=document.getElementById(o))==null||v.scrollIntoView({block:"nearest"})},120)}},r=s=>{var c;const i=s.target;if(!i||typeof i.closest!="function")return;document.querySelectorAll("#page .on").forEach(d=>d.classList.remove("on"));const o=i.closest("mark[data-thr]");if(o){const d=o.dataset.thr??"";o.classList.add("on"),(c=document.getElementById(d))==null||c.classList.add("on");return}const l=i.closest("#page .ithread");l!=null&&l.id&&(l.classList.add("on"),document.querySelectorAll(`mark[data-thr="${CSS.escape(l.id)}"]`).forEach(d=>d.classList.add("on")))};return document.addEventListener("click",t),document.addEventListener("mouseover",r),()=>{document.removeEventListener("click",t),document.removeEventListener("mouseover",r)}},[]),null}function W2({reviewId:e,cardId:n,blockId:t}){const r=D(c=>{var d;return(d=c.snapshot)==null?void 0:d.annotations}),s=Cr(),[i,o]=h.useState(null);h.useEffect(()=>{const c=d=>{const u=d.detail;u.anchor.where==="block"&&xr(u.anchor.blockId,n,t)&&(mt()||o(u))};return window.addEventListener(Ot,c),()=>window.removeEventListener(Ot,c)},[n,t]);const l=(r??[]).filter(c=>c.type==="thread"&&c.anchor.host.kind==="block"&&xr(c.anchor.host.blockId,n,t)&&c.open);return!i&&l.length===0?null:a.jsxs(a.Fragment,{children:[l.map(c=>a.jsx(Ii,{reviewId:e,thread:c,readOnly:s},c.id)),i&&!s?a.jsx(Di,{reviewId:e,anchor:i.anchor,quote:i.quote,note:i.note,onDiscard:()=>o(null),onCreated:c=>{o(null),T.updateComment(e,c,{open:!0}).catch(()=>{}),window.setTimeout(()=>{var d;(d=document.getElementById(c))==null||d.scrollIntoView({block:"nearest"})},120)}},"pending"):null]})}function V2(e){return e.type==="expansion"&&e.open&&!e.promotedToPage}function K2(e){return e.type==="expansion"&&!e.open&&!e.promotedToPage}function _2(e){return e.type==="link"||!!e.promotedToPage}function so(e){var n;return!!e.anchorStale||!!((n=e.expansion)!=null&&n.anchorStale)}function kh(e){return e?/no agent configured/i.test(e):!1}const _o="No agent configured — set up Claude or Codex in Settings → Models to generate explanations.";function G2(e,n){const t=document.createElement("mark");return t.className=n?"anc exl":"anc ex",t.dataset.jump=e,t}function q2(e){const n=document.createElement("a");return n.className="cx pg",n.dataset.node=e,n.title="Opened as its own page",n}function Q2(){const e=D(t=>{var r;return(r=t.snapshot)==null?void 0:r.annotations}),n=D(t=>{var r;return(r=t.snapshot)==null?void 0:r.pages});return h.useEffect(()=>{const t=document.getElementById("page");if(!t)return;const r=window.setTimeout(()=>{Ss(t,()=>{Cs(t,"mark.anc.ex[data-jump], mark.anc.exl[data-jump], a.cx.pg[data-node]");const s=new Set;for(const i of e??[]){if(i.type!=="expansion"&&i.type!=="link"||so(i)||!i.anchor.quotedText||i.anchor.host.kind!=="block")continue;const o=i.promotedToPage??(i.type==="link"?i.promotedToPage:void 0);if(i.type==="link"||o){const f=o??"";if(!f)continue;const{cardId:p,block:A}=pu(i.anchor.host.blockId),v=p?[`${p}#${A}`,A,i.anchor.host.blockId]:[A,i.anchor.host.blockId];for(const x of v)if(gs(t,x,i.anchor.quotedText,()=>q2(f))){s.add(i.id);break}continue}const l=!i.open,{cardId:c,block:d}=pu(i.anchor.host.blockId),u=[i.anchor.host.blockId,d];for(const f of u)if(gs(t,f,i.anchor.quotedText,()=>G2(i.id,l))){s.add(i.id);break}}for(const i of t.querySelectorAll("[data-fallback]")){const o=i.dataset.fallback??"";o&&!s.has(o)?i.hidden=!1:o&&s.has(o)&&(i.hidden=!0)}})},0);return()=>window.clearTimeout(r)},[e,n]),h.useEffect(()=>{const t=s=>{var u,f;const i=(f=(u=s.target)==null?void 0:u.closest)==null?void 0:f.call(u,"mark.anc[data-jump]");if(!i)return;const o=i.dataset.jump??"",l=D.getState().snapshot,c=l==null?void 0:l.review.id,d=l==null?void 0:l.annotations.find(p=>p.id===o);!c||!d||(d.type==="expansion"&&!d.open&&T.updateComment(c,o,{open:!0}).catch(p=>{F(`Couldn't expand: ${V(p)}`)}),window.setTimeout(()=>{var p;(p=document.getElementById(`B-${o}`))==null||p.scrollIntoView({block:"nearest"})},120))},r=s=>{var c;const i=s.target;if(!i||typeof i.closest!="function")return;const o=i.closest("mark[data-jump]");if(document.querySelectorAll("#page .on").forEach(d=>d.classList.remove("on")),o){const d=o.dataset.jump??"";o.classList.add("on"),(c=document.getElementById(`B-${d}`))==null||c.classList.add("on");return}const l=i.closest("#page .card.child");if(l!=null&&l.id){l.classList.add("on");const d=l.id.replace(/^B-/,"");document.querySelectorAll(`mark[data-jump="${CSS.escape(d)}"]`).forEach(u=>u.classList.add("on"))}};return document.addEventListener("click",t),document.addEventListener("mouseover",r),()=>{document.removeEventListener("click",t),document.removeEventListener("mouseover",r)}},[]),null}function pu(e){const n=e.indexOf("#");return n<0?{cardId:null,block:e}:{cardId:e.slice(0,n),block:e.slice(n+1)}}function Z2(e,n,t){return e?e.filter(r=>(r.type==="expansion"||r.type==="link")&&r.anchor.host.kind==="block"&&xr(r.anchor.host.blockId,n,t)):[]}function rl(e){const{snapshot:n,setSnapshot:t}=D.getState();n&&t(e(n))}const sl="unvibe:guide-block";function hc(e,n){window.dispatchEvent(new CustomEvent(sl,{detail:{cardId:e,blockId:n}}))}async function hu(e){try{D.getState().setSnapshot(await T.review(e))}catch{}}function Y2(e,n,t,r){const s=D.getState().snapshot;if(!s)return;const i=s.pages.find(l=>l.cards.some(c=>c.id===t));if(!i)return;const o=()=>{rl(l=>({...l,pages:l.pages.map(c=>({...c,cards:c.cards.map(d=>d.id===t&&d.collapsed?{...d,collapsed:!1}:d)}))})),window.setTimeout(()=>{const l=document.getElementById(`B-${r}`)??document.getElementById(`C-${t}`);if(!l)return;const c=window.matchMedia("(prefers-reduced-motion: reduce)").matches;l.scrollIntoView({block:"center",behavior:c?"auto":"smooth"}),l.classList.add("hl"),window.setTimeout(()=>l.classList.remove("hl"),2e3)},60)};i.id!==n&&e(i.id==="root"?null:i.id),window.setTimeout(o,i.id!==n?80:0)}function X2(e){return e.accepted?!1:(F("That action needs the service — open this review against the real service to generate."),!0)}async function Gn(e,n){(n.kind==="read"||n.kind==="collapse")&&rl(r=>({...r,pages:r.pages.map(s=>({...s,cards:s.cards.map(i=>i.id!==n.cardId?i:n.kind==="read"?{...i,read:n.read,collapsed:!!n.read}:{...i,collapsed:n.collapsed})}))})),n.kind==="bookmark"&&rl(r=>({...r,pages:r.pages.map(s=>s.id===n.pageId?{...s,saved:n.saved}:s)}));let t;try{t=await T.action(e,n)}catch(r){const s=r instanceof Error?r.message:String(r);throw/no agent configured/i.test(s)?F("No agent configured — set up Claude or Codex in Settings → Models to generate."):F(`Action failed: ${V(r)}`),await hu(e),r}return(n.kind==="read"||n.kind==="collapse"||n.kind==="bookmark")&&!t.accepted?(await hu(e),t):(X2(t)||t.reused&&(n.kind==="depth"?F("Already at the deepest level — nothing more to add."):(n.kind==="examples"||n.kind==="diagram")&&F("Nothing more to add to this card.")),t)}function mc(e,n,t,r){const s=D.getState().snapshot,i=[...(s==null?void 0:s.pages.flatMap(d=>d.cards))??[],...((s==null?void 0:s.annotations)??[]).filter(d=>d.type==="expansion"&&d.expansion).map(d=>({id:d.id,blocks:d.expansion.blocks}))],o=i.find(d=>d.id===n);let l=o==null?void 0:o.blocks.find(d=>d.id===t);if(!l||l.type!=="follow-up"){e:for(const d of i)for(const u of d.blocks)if(u.id===t&&u.type==="follow-up"){l=u;break e}}!l||l.type!=="follow-up"||!l.items[r]||Gn(e,{kind:"followup",cardId:n,blockId:t,index:r}).catch(()=>{})}function J2(e){T.update(e).catch(n=>{F(`Update failed: ${V(n)}`)})}function wh(e,n){if(!n)return null;const t=new Map(n.map(i=>[i.id,i])),s=uc(e,i=>t.get(i));return s||(t.has(e)?e:null)}function yh({html:e,className:n,top:t,onOpenPage:r}){const s=D(o=>{var l;return(l=o.snapshot)==null?void 0:l.pages}),i=h.useMemo(()=>s?$0(e,s):e,[e,s]);return a.jsx("span",{className:n,...t!==void 0?{"data-top":t}:{},dangerouslySetInnerHTML:{__html:i},onClick:o=>bh(o,s,r)})}function bh(e,n,t){var o,l;const r=e.target,s=(o=r.closest)==null?void 0:o.call(r,"a.cx[data-node], a.cx[data-link]");if(s){e.preventDefault(),Ch(s.getAttribute("data-link")??s.getAttribute("data-node")??"",n,t);return}const i=(l=r.closest)==null?void 0:l.call(r,"[data-src]");i&&Cn(i.getAttribute("data-src")??"")}function Ch(e,n,t){var s;const r=wh(e,n);if(r){t(r);return}if(e.startsWith("card:")){const[i,o]=e.slice(5).split("#");if((n==null?void 0:n.find(c=>c.cards.some(d=>d.id===i)))&&i){hc(i,o??"");return}F("That card isn't in this review.");return}if(e.startsWith("concept:")){const i=e.slice(8),o=(s=D.getState().snapshot)==null?void 0:s.review.id;if(!o){F("The review hasn't loaded yet.");return}const l=`c-${i}`;n!=null&&n.some(c=>c.id===l)&&t(l),T.action(o,{kind:"concept",slug:i}).then(c=>{c.accepted&&c.pageId?t(c.pageId):c.accepted||F("Needs the service to write this concept page.")}).catch(c=>{const d=c instanceof Error?c.message:String(c);/no agent configured/i.test(d)?F("No agent configured — set up Claude or Codex in Settings → Models to write concept pages."):F(`Couldn't open the concept: ${V(c)}`)}),t(l);return}F("That link can't be opened yet.")}function $2(e,n){if(!n)return null;const t=wh(e,n);if(t){const r=n.find(i=>i.id===t);if(!r)return null;const s=q0(r);return`<b>${r.title.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</b>${s?`<div class="xprev">${s}</div>`:""}`}if(e.startsWith("card:")){const[r]=e.slice(5).split("#"),s=n.find(l=>l.cards.some(c=>c.id===r)),i=s==null?void 0:s.cards.find(l=>l.id===r);return i?`<b>${(i.title??dc(i).slice(0,80)).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</b><span class="hint">Click to open</span>`:null}return e.startsWith("concept:")?`<b>${e.slice(8).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</b><span class="hint">Concept candidate · the page is written when first opened</span>`:null}const ev=200,nv=220,kn=e=>e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),tv=e=>kn(e).replace(/`([^`]+)`/g,"<code>$1</code>");function rv(e){return e.map(n=>{const t=n.who==="you"?"You":n.suggested?"Agent · suggested comment":"Agent",r=n.who==="you"?"you":"ai",s=n.who==="you"?"Me":"AI";return`<div class="msg"><span class="av ${r}">${s}</span><div><div class="who">${t}</div><p>${n.html??tv(n.text??"")}</p></div></div>`}).join("")}function mu(e){const n=e.host;if(n.kind==="diff-line"){const t=n.endLine&&n.endLine!==n.line?`${n.line}-${n.endLine}`:`${n.line}`;return`diff:${n.fileKey}:${t}`}return n.kind==="description"?`desc:${n.paragraphId}`:null}function Au(e){return e?(e.outdated?'<div class="pv outdated"><div class="q">Outdated · the code changed</div>'+(e.originalSnippet?`<div class="snip">${kn(e.originalSnippet).slice(0,200)}</div>`:"")+(e.successor&&mu(e.successor)?`<button class="cite" data-src="${kn(mu(e.successor))}"><span class="loc">See the new code →</span></button>`:"")+"</div>":"")+`<div class="pv">${e.anchor.quotedText?`<div class="q">“${kn(e.anchor.quotedText)}”</div>`:""}${rv(e.messages.slice(0,2))}${e.messages.length>2?`<span class="hint">+${e.messages.length-2} more</span>`:""}</div>`:""}function gu(e){const n=Q0(e);return`<b>${kn(e.title)}</b>${n?`<div class="xprev">${n}</div>`:""}`}function sv(e){var o,l,c;if(!e)return"";const n=((o=e.expansion)==null?void 0:o.blocks)??[],t=((l=e.expansion)==null?void 0:l.level)??"standard";let r="";for(const d of n)if(d.type==="paragraph"){const u=t==="simple"?d.text.simple??d.text.standard:t==="deep"?d.text.deep??d.text.standard:d.text.standard;if(u.trim()){r=u;break}}const s=e.working??((c=e.expansion)==null?void 0:c.working),i=r?`<div class="xprev">${r}</div>`:s?`<span class="hint">${kn(s)}</span>`:'<span class="hint">Explanation is filling…</span>';return`<b>“${kn(e.anchor.quotedText)}”</b>${i}`}const iv="[data-refs], [data-threads], a.cx[data-node], a.cx[data-link], [data-cprev], [data-cjump], mark.anc[data-jump]";function ov(){const[e,n]=h.useState(null),t=h.useRef(null),r=h.useRef(null),s=h.useRef(void 0),i=h.useRef(void 0),o=h.useRef(null),l=h.useRef(!1),c=Qn(),{id:d}=rc(),u=()=>{window.clearTimeout(s.current),window.clearTimeout(i.current),o.current=null,t.current=null,n(null)},f=h.useRef(u);f.current=u;const p=v=>{const x=D.getState().snapshot;if(!x)return;const w=new Map(x.pages.map(b=>[b.id,b])),g=b=>w.get(b),m=v.dataset;let k="";if(m.refs){const b=m.refs.split("|");k=$a(x,b.map(C=>({target:C}))).map(C=>`<button class="cite" data-src="${kn(C.target)}"><span class="loc">${kn(C.label)}${C.unverified?" · unverified":""}</span><span class="snip">${kn(C.snippet)}</span></button>`).join("")}else if(m.threads)k=m.threads.split("|").map(y=>Au(x.annotations.find(C=>C.id===y))).join("")+'<span class="hint">Click to open</span>';else if(m.cprev||m.cjump){const b=m.cprev??m.cjump??"";k=Au(x.annotations.find(y=>y.id===b))+'<span class="hint">Click to go to it in the diff</span>'}else if(m.jump){const b=m.jump,y=x.annotations.find(C=>C.id===b);if(y&&(y.type==="expansion"||y.type==="link"))if(y.promotedToPage){const C=g(y.promotedToPage);k=C?`${gu(C)}<span class="hint">Click to open</span>`:`<b>${kn(y.anchor.quotedText)}</b><span class="hint">Click to open</span>`}else k=sv(y)+'<span class="hint">Click to expand in place</span>'}else if(v.matches("a.cx[data-node], a.cx[data-link]")){const b=v.dataset.link??v.dataset.node??"";let y;b.startsWith("page:")?y=g(b.slice(5)):b.startsWith("concept:")?y=ph(g,b.slice(8)):y=g(b),y?k=`${gu(y)}<span class="hint">Click to open</span>`:k=$2(b,x.pages)??""}k&&(t.current=v,n(k))},A=h.useRef(p);return A.current=p,h.useLayoutEffect(()=>{const v=r.current,x=t.current;if(!e||!v||!x)return;const w=x.getBoundingClientRect(),g=v.offsetWidth,m=v.offsetHeight;let k=w.bottom+6;k+m>window.innerHeight-8&&(k=Math.max(8,w.top-m-6)),v.style.left=`${Math.max(8,Math.min(window.innerWidth-g-8,w.left))}px`,v.style.top=`${k}px`},[e]),h.useEffect(()=>{const v=()=>{window.clearTimeout(s.current),window.clearTimeout(i.current)},x=y=>{(y.movementX||y.movementY)&&(l.current=!1)},w=y=>{if(l.current)return;const C=y.target;if(!C||typeof C.closest!="function")return;if(C.closest("#pop")){v();return}const S=C.closest(iv);if(v(),o.current=S,S){if(S!==t.current){const N=S;s.current=window.setTimeout(()=>{l.current||!N.isConnected||o.current!==N||A.current(N)},ev)}}else t.current&&(i.current=window.setTimeout(()=>f.current(),nv))},g=y=>{var C,S;(S=(C=y.target)==null?void 0:C.closest)!=null&&S.call(C,"#pop")||(l.current=!0,f.current())},m=y=>{var C,S;(S=(C=y.target)==null?void 0:C.closest)!=null&&S.call(C,"#pop")||f.current()},k=y=>{y.key==="Escape"&&f.current()},b=()=>{f.current()};return document.addEventListener("pointermove",x,!0),document.addEventListener("mouseover",w),document.addEventListener("scroll",g,!0),document.addEventListener("wheel",g,{capture:!0,passive:!0}),document.addEventListener("pointerdown",m,!0),document.addEventListener("keydown",k),document.documentElement.addEventListener("mouseleave",b),window.addEventListener("blur",f.current),window.addEventListener("resize",f.current),()=>{document.removeEventListener("pointermove",x,!0),document.removeEventListener("mouseover",w),document.removeEventListener("scroll",g,!0),document.removeEventListener("wheel",g,!0),document.removeEventListener("pointerdown",m,!0),document.removeEventListener("keydown",k),document.documentElement.removeEventListener("mouseleave",b),window.removeEventListener("blur",f.current),window.removeEventListener("resize",f.current),v()}},[]),a.jsx("div",{id:"pop",ref:r,hidden:e===null,onClick:v=>{var m,k,b;const x=v.target,w=(m=x.closest)==null?void 0:m.call(x,"[data-src]");if(w){Cn(w.getAttribute("data-src")??""),f.current();return}const g=(k=x.closest)==null?void 0:k.call(x,"a.cx[data-node], a.cx[data-link]");if(g){v.preventDefault();const y=g.dataset.link??g.dataset.node??"";Ch(y,(b=D.getState().snapshot)==null?void 0:b.pages,C=>{const S=D.getState().snapshot,N=S==null?void 0:S.pages.find(M=>M.id===C);c((N==null?void 0:N.kind)==="root"?`/review/${d}`:`/review/${d}/page/${encodeURIComponent(C)}`)}),f.current()}},dangerouslySetInnerHTML:e?{__html:e}:void 0})}const av=180;function lv(){const e=h.useRef(null);return h.useEffect(()=>{const n=e.current;if(!n)return;let t=null,r,s=!1;const i=()=>{window.clearTimeout(r),r=void 0,t=null,n.hidden=!0},o=()=>{if(!t||!t.isConnected)return;n.textContent=t.dataset.tip??"",n.hidden=!1;const A=t.getBoundingClientRect();let v=A.top-n.offsetHeight-6;v<4&&(v=A.bottom+6),n.style.left=`${Math.max(4,Math.min(window.innerWidth-n.offsetWidth-4,A.left+A.width/2-n.offsetWidth/2))}px`,n.style.top=`${v}px`},l=A=>{var w,g;if(s)return;const v=A.target,x=(w=v==null?void 0:v.closest)==null?void 0:w.call(v,"[data-tip]");x&&!((g=v==null?void 0:v.closest)!=null&&g.call(v,"#pop"))?x!==t&&(window.clearTimeout(r),t=x,r=window.setTimeout(o,av)):i()},c=A=>{((A.movementX??0)!==0||(A.movementY??0)!==0)&&(s=!1)},d=A=>{var v,x;(x=(v=A.target)==null?void 0:v.closest)!=null&&x.call(v,"#pop")||(s=!0,i())},u=()=>{n.hidden=!0},f=A=>{A.key==="Escape"&&i()},p=()=>{i()};return document.addEventListener("mouseover",l),document.addEventListener("pointermove",c,!0),document.addEventListener("scroll",d,!0),document.addEventListener("pointerdown",u,!0),document.addEventListener("keydown",f),document.documentElement.addEventListener("mouseleave",p),window.addEventListener("blur",i),window.addEventListener("resize",i),()=>{window.clearTimeout(r),document.removeEventListener("mouseover",l),document.removeEventListener("pointermove",c,!0),document.removeEventListener("scroll",d,!0),document.removeEventListener("pointerdown",u,!0),document.removeEventListener("keydown",f),document.documentElement.removeEventListener("mouseleave",p),window.removeEventListener("blur",i),window.removeEventListener("resize",i)}},[]),a.jsx("div",{id:"tip",ref:e,hidden:!0})}function cv(e){var r;if(e.draft!==void 0&&e.draft!=="")return e.draft;const n=e.messages.find(s=>s.who==="you"&&s.text);if(n!=null&&n.text)return n.text;const t=e.messages.find(s=>s.suggested&&s.text);return t!=null&&t.text?t.text:((r=e.messages.find(s=>s.text))==null?void 0:r.text)??""}function dv(e){return e.postedAt!==void 0}function uv(e){return e?(e.annotations??[]).filter(n=>n.type==="thread"&&n.post&&!dv(n)):[]}function Sh(e){var r;if(!e)return 0;const n=uv(e).length,t=((r=e.description)==null?void 0:r.pendingHtml)!==void 0?1:0;return n+t}function vu(){const e=Qn(),n=Vt(),t=ro(),r=D(d=>d.snapshot),s=r==null?void 0:r.review;if(!s||s.versions.length<2)return null;const i=s.currentVersion,o=t??i,l=t!==void 0&&t!==i,c=d=>{const u=new URLSearchParams(n.search);d===i?u.delete("version"):u.set("version",String(d));const f=u.toString();e(`${n.pathname}${f?`?${f}`:""}`)};return a.jsxs("div",{className:"frow",style:{gap:8,marginBottom:4},"data-testid":"version-switcher",children:[a.jsx("label",{className:"hint",htmlFor:"version-pick",children:"Version"}),a.jsx("select",{id:"version-pick","aria-label":"View version",value:o,onChange:d=>c(Number(d.target.value)),style:{border:"1px solid var(--line)",borderRadius:6,padding:"2px 6px",background:"var(--surface)",color:"var(--ink)",fontSize:12.5},children:s.versions.map(d=>a.jsxs("option",{value:d.n,children:["v",d.n,d.n===i?" (current)":""," · ",d.headSha.slice(0,8)]},d.n))}),l?a.jsxs("span",{className:"hint",role:"status",children:["Viewing v",t," · read-only ·"," ",a.jsx("button",{type:"button",className:"x",onClick:()=>c(i),children:"Back to current"})]}):null]})}const fv=new Set(["script","foreignobject","iframe","object","embed","link","meta","audio","video","image"]);let pv=0;function hv(e){return e==="#"||e!==null&&e.startsWith("#")&&e.length>1}function mv(e,n){const t=`.${n}`,r=[];for(const s of e.split("}")){const i=s.indexOf("{");if(i<0){s.trim()!==""&&r.push(s);continue}const o=s.slice(0,i),l=s.slice(i);if(/^\s*@/.test(o)){r.push(`${o}${l}}`);continue}const c=o.split(",").map(d=>d.trim()===""?d:`${t} ${d.trim()}`).join(", ");r.push(`${c}${l}}`)}return r.join("")}function Av(e,n){const t=`d2u${pv++}`;let r;try{r=new DOMParser().parseFromString(e,"image/svg+xml")}catch{return null}if(r.getElementsByTagName("parsererror").length>0)return null;const s=r.documentElement;if(!s||s.tagName.toLowerCase()!=="svg")return null;for(const l of[...r.getElementsByTagName("*")])fv.has(l.tagName.toLowerCase())&&l.remove();const i=new Map;for(const l of[...r.getElementsByTagName("*")]){const c=l.getAttribute("id");if(c!==null&&c!==""){const d=`${t}-${c}`;i.set(c,d),l.setAttribute("id",d)}}const o=l=>l.replace(/url\(#([^)]+)\)/g,(c,d)=>i.has(d)?`url(#${i.get(d)})`:`url(#${d})`);for(const l of[...r.getElementsByTagName("*")]){const c=l.tagName.toLowerCase();for(const d of[...l.attributes]){const u=d.name.toLowerCase();if(u.startsWith("on")){l.removeAttribute(d.name);continue}if(u==="href"||u==="xlink:href"){const f=d.value.startsWith("#")?d.value:null;if(l.removeAttribute(d.name),f!==null&&hv(f)){const p=f.length>1&&i.has(f.slice(1))?`#${i.get(f.slice(1))}`:f;l.setAttribute(d.name,p)}continue}u==="style"&&l.setAttribute(d.name,o(d.value))}c==="a"&&(l.hasAttribute("tabindex")||l.setAttribute("tabindex","0"),l.hasAttribute("data-refs")&&!l.hasAttribute("aria-label")&&l.setAttribute("aria-label",l.hasAttribute("data-unverified")?"Show cited source (unverified)":"Show cited source")),c==="style"&&l.textContent&&(l.textContent=mv(o(l.textContent),t))}return s.classList.add(t),s.hasAttribute("aria-label")||s.setAttribute("aria-label","Diagram"),s}function gv(e,n){const t=Av(e);return t?document.importNode(t,!0):null}function xu(){const e=document.documentElement.getAttribute("data-theme");return e==="dark"?"dark":e==="light"?"light":window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function vv(){const[e,n]=h.useState(()=>xu());return h.useEffect(()=>{const t=window.matchMedia("(prefers-color-scheme: dark)"),r=()=>n(xu()),s=new MutationObserver(r);return s.observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]}),t.addEventListener("change",r),()=>{s.disconnect(),t.removeEventListener("change",r)}},[]),e}const ku=new Map,qs=new Map;function xv(e){if(typeof e.source=="string"&&e.source!=="")return e.source;const n=e.mermaid;return typeof n=="string"?n:""}function kv({reviewId:e,block:n,fetchSvg:t}){const r=vv(),s=h.useRef(null),i=n.render,o=i==null?void 0:i.status,l=(i==null?void 0:i.hash)??"",[c,d]=h.useState(()=>l!==""?{kind:"loading"}:!i||o==="unavailable"?{kind:"fallback",note:"unavailable",message:(i==null?void 0:i.error)??""}:{kind:"fallback",note:"error",message:(i==null?void 0:i.error)??"This diagram could not be rendered."});if(h.useEffect(()=>{if(!l)return;let u=!1;d({kind:"loading"});const f=`${l}:${r}`,p=ku.get(f),A=w=>{u||d({kind:"ready",svgText:w})},v=w=>{if(u)return;if(w instanceof Bi){d({kind:"fallback",note:w.status,message:w.detail??""});return}const g=w instanceof Error?w.message:String(w);if(/: 404(\s|$)/.test(g)){d({kind:"fallback",note:"not-found",message:"This diagram is not on the service."});return}d({kind:"fallback",note:"error",message:g.slice(0,220)||"This diagram could not be rendered."})};if(p!==void 0)return A(p),()=>{u=!0};let x=qs.get(f);return x||(x=(t??T.diagramSvg)(e,l,r).then(w=>(ku.set(f,w),w)),qs.set(f,x),x.then(()=>qs.delete(f),()=>qs.delete(f))),x.then(A,v),()=>{u=!0}},[e,l,r,o,t]),h.useEffect(()=>{const u=s.current;if(!u||c.kind!=="ready")return;u.textContent="";const f=gv(c.svgText);if(f)return u.appendChild(f),()=>{u.textContent=""};d({kind:"fallback",note:"error",message:"The service returned a diagram the app could not read."})},[c]),c.kind==="loading")return a.jsx("div",{className:"dg-loading",role:"status","aria-label":"Rendering diagram",children:a.jsxs("span",{className:"working",children:[a.jsxs("span",{className:"dots","aria-hidden":"true",children:[a.jsx("i",{}),a.jsx("i",{}),a.jsx("i",{})]}),a.jsx("span",{children:"Rendering diagram…"})]})},"d2-loading");if(c.kind==="fallback"){const u=xv(n);return a.jsxs("div",{className:"dg-fallback",children:[u!==""?a.jsx("pre",{className:"code",children:u}):null,c.note==="unavailable"?a.jsxs("p",{className:"hint",children:["Diagrams need ",a.jsx("code",{children:"d2"}),c.message!==""?` (${c.message})`:""," — the diagram source is shown above. ",a.jsx(cn,{to:"/settings#environment",children:"Settings → Environment"})," has the install hint."]}):a.jsxs("p",{className:"hint",children:["This diagram could not be rendered",c.message!==""?`: ${c.message}`:""," — its source is shown above."]})]},"d2-fallback")}return a.jsx("div",{ref:s,className:"dg-svg",onClick:u=>{var A,v;const f=(v=(A=u.target)==null?void 0:A.closest)==null?void 0:v.call(A,"a[href]");if(!f)return;u.preventDefault();const p=f.getAttribute("data-src");p&&Cn(p)}},"d2-ready")}function Eh({reviewId:e,block:n}){return a.jsxs(a.Fragment,{children:[a.jsx("div",{className:"dg dg-d2",children:a.jsx(kv,{reviewId:e,block:n})}),n.caption?a.jsx("p",{className:"dg-cap",children:n.caption}):null]})}function Et({citations:e,threads:n,blockId:t}){const r=e.filter(i=>!i.unverified),s=e.filter(i=>i.unverified);return!e.length&&!n.length?null:a.jsxs("span",{className:"lo",children:[r.length>0&&a.jsxs("button",{className:"lk",type:"button","data-refs":r.map(i=>i.target).join("|"),"data-src":r[0].target,"aria-label":r.length>1?`${r.length} sources`:"Source","data-tip":"Show in source",onClick:()=>Cn(r[0].target),children:[a.jsx(q,{name:"code"}),r.length>1?r.length:""]}),s.map(i=>a.jsx("button",{className:"lk unverified",type:"button","data-refs":i.target,"data-src":i.target,"aria-label":"Unverified source","data-tip":"This citation could not be checked, so it is shown as unverified.",onClick:()=>Cn(i.target),children:a.jsx(q,{name:"code"})},i.target)),n.length>0&&a.jsxs("button",{className:"lk cm",type:"button","data-threads":n.map(i=>i.id).join("|"),"aria-label":`${n.length} comments`,"data-tip":"Preview the comment thread",onClick:()=>t2(n[0].id,t),children:[a.jsx(q,{name:"comment"}),n.length]})]})}function wv({id:e,html:n,citations:t,threads:r,blockId:s,onOpenPage:i}){return a.jsxs("p",{className:"prose sel","data-top":e,children:[a.jsx(yh,{html:n,className:"rt",top:e,onOpenPage:i}),a.jsx(Et,{citations:t,threads:r,blockId:s})]})}function yv({inner:e,top:n,reviewId:t,onOpenPage:r}){switch(e.type){case"paragraph":return a.jsx("p",{className:"prose sel","data-top":n,children:a.jsx(yh,{html:e.text.standard,className:"rt",top:n,onOpenPage:r})});case"code":return a.jsx("pre",{className:"code sel","data-top":n,children:e.code});case"diagram":return a.jsx(Eh,{reviewId:t,block:e});case"list":return a.jsx("ul",{className:"lst",children:e.items.map((s,i)=>a.jsx("li",{children:a.jsx("span",{className:"sel","data-top":n,dangerouslySetInnerHTML:{__html:s.html}})},i))});default:return null}}function wu(e,n,t){bh(e,n,t)}function Ac({block:e,level:n,threads:t,lookupPage:r,onOpenPage:s,onFollowUp:i}){const o=D(p=>p.snapshot),l=o==null?void 0:o.pages,c="citations"in e&&Array.isArray(e.citations)?e.citations:[],d=o?$a(o,c):[],u=`B-${e.id}`,f=(o==null?void 0:o.review.id)??"";switch(e.type){case"paragraph":{const p=to(e.text,n);return a.jsx("div",{className:"blk",id:u,children:a.jsx(wv,{id:e.id,html:p,citations:d,threads:t,blockId:e.id,onOpenPage:s})})}case"list":{const p=e.items.map((v,x)=>{const w=o?$a(o,v.citations):[];return a.jsxs("li",{id:`${u}-${x}`,children:[a.jsx("span",{className:"sel","data-top":e.id,dangerouslySetInnerHTML:{__html:v.html},onClick:g=>wu(g,l,s)}),a.jsx(Et,{citations:w,threads:x===0?t:[],blockId:e.id})]},x)}),A=e.ordered?a.jsx("ol",{className:"lst",children:p}):a.jsx("ul",{className:"lst",children:p});return a.jsxs("div",{className:"blk",id:u,children:[A,(d.length>0||t.length>0)&&a.jsx("div",{className:"lo-row",children:a.jsx(Et,{citations:d,threads:[],blockId:e.id})})]})}case"table":return a.jsxs("div",{className:"blk",id:u,children:[a.jsx("div",{className:"md sel","data-top":e.id,dangerouslySetInnerHTML:{__html:e.html},onClick:p=>wu(p,l,s)}),(d.length>0||t.length>0)&&a.jsx("div",{className:"lo-row",children:a.jsx(Et,{citations:d,threads:t,blockId:e.id})})]});case"code":return a.jsxs("div",{className:"blk",id:u,children:[a.jsx("pre",{className:"code sel","data-top":e.id,children:e.code}),(d.length>0||t.length>0)&&a.jsx("div",{className:"lo-row",children:a.jsx(Et,{citations:d,threads:t,blockId:e.id})})]});case"diagram":return a.jsxs("div",{className:"blk",id:u,children:[a.jsx(Eh,{reviewId:f,block:e}),(d.length>0||t.length>0)&&a.jsx("div",{className:"lo-row",children:a.jsx(Et,{citations:d,threads:t,blockId:e.id})})]});case"aside":return a.jsxs("div",{className:"blk gen-aside fresh",id:u,children:[a.jsx("div",{className:"tag",children:e.kind}),e.inner.map(p=>a.jsx(yv,{inner:p,top:e.id,reviewId:f,onOpenPage:s},p.id)),t.length>0&&a.jsx("div",{className:"lo-row",children:a.jsx(Et,{citations:[],threads:t,blockId:e.id})})]});case"finding-link":{const p=r==null?void 0:r(e.pageId),A=p?cc(p):!1;return a.jsx("div",{className:"blk",id:u,children:a.jsxs("button",{className:`findref${A?" read":""}`,type:"button","data-node":e.pageId,onClick:()=>s(e.pageId),children:[a.jsxs("span",{className:"ftag",children:["Agent finding · ",(p==null?void 0:p.confidence)??""," confidence"]}),a.jsx("span",{className:"ft",children:(p==null?void 0:p.title)??e.pageId}),a.jsx("span",{className:"fs",children:(p==null?void 0:p.summary)??""}),a.jsx("span",{className:"fo",children:"Open →"})]})})}case"comment-link":{const p=o==null?void 0:o.annotations.find(v=>v.id===e.threadId),A=o?gh(o,{target:e.diffRef}).label:e.diffRef;return a.jsx("div",{className:"blk",id:u,children:a.jsxs("button",{className:"clink",type:"button","data-cjump":e.threadId,"data-cprev":e.threadId,onClick:()=>Cn(e.diffRef),children:[a.jsx(q,{name:"comment"}),a.jsxs("span",{children:["Suggested review comment on ",a.jsx("b",{children:A})]}),a.jsx("span",{className:"sp"}),p!=null&&p.post?a.jsx("span",{className:"prtag",children:"For PR"}):null,"→"]})})}case"follow-up":return e.items.length?a.jsxs("div",{className:"follow",children:[a.jsx("span",{className:"k",children:"Follow up:"}),e.items.map((p,A)=>a.jsx("button",{type:"button","data-follow":e.id,"data-i":A,onClick:()=>i(e.id,A),children:p.label},A))]}):null;default:return null}}function bv(e,n){if(!e||!e.startsWith("card:"))return null;const t=e.slice(5),[r,s]=t.split("#");return r!==n?null:s??null}function Cv({reviewId:e,card:n,contributions:t}){const[r,s]=h.useState(null),i=t.filter(c=>c.status==="pending"),o=[];for(const c of i)c.items.forEach((d,u)=>{if(d.kind!=="correction")return;const f=bv(d.target,n.id);(f!==null||d.target===`card:${n.id}`)&&o.push({contribution:c,itemIndex:u,block:f})});if(o.length===0)return null;const l=(c,d,u)=>{s(c),d().then(()=>F(u)).catch(f=>{F(`Couldn't update the suggestion: ${V(f)}`)}).finally(()=>s(null))};return a.jsx(a.Fragment,{children:o.map(({contribution:c,itemIndex:d})=>{const u=c.items[d],f=`${c.id}:${d}`,p=c.sourceThread??c.sourceSession;return a.jsxs("div",{className:"suggest","data-correction":c.id,children:[a.jsx("div",{className:"stag",children:"Suggested correction · pending"}),a.jsx("p",{children:u.text}),u.citations.length>0?a.jsxs("p",{className:"hint",children:["cites:"," ",u.citations.map(A=>a.jsx("button",{className:"cite",type:"button",onClick:()=>Cn(A.target),children:a.jsx("span",{className:"loc",children:A.target})},A.target))]}):null,a.jsxs("div",{className:"frow",children:[p?a.jsxs("span",{className:"hint",children:["from"," ",a.jsxs("button",{className:"x",type:"button",onClick:()=>{var A;(A=document.getElementById(p))==null||A.scrollIntoView({block:"nearest"})},children:["thread ",p]})]}):a.jsxs("span",{className:"hint",children:["from ",c.sourceSession]}),a.jsx("span",{className:"sp"}),a.jsx("button",{className:"btn ghost",type:"button",disabled:r===f,onClick:()=>l(f,()=>T.dismissContribution(e,c.id),"Correction dismissed."),children:"Dismiss"}),a.jsx("button",{className:"btn",type:"button",disabled:r===f,onClick:()=>l(f,()=>T.acceptContribution(e,c.id),"Correction accepted — new card revision."),children:"Accept"})]})]},f)})})}function Sv(e){return e==="agrees"?"Agrees":e==="partly"?"Partly":"Disagrees"}function jh({reviewId:e,card:n,result:t,lookupPage:r,onOpenPage:s,onFollowUp:i}){const o=[],l=t.verdict==="disagrees";return a.jsxs("section",{className:`so${l?" so-dis":""}`,"data-so":t.id,"data-verdict":t.verdict,"aria-label":`Second opinion (${t.verdict})`,children:[a.jsxs("div",{className:"so-h",children:[a.jsx("span",{className:"so-tag",children:"Second opinion"}),a.jsxs("span",{className:"so-model",title:`${t.provider}/${t.model}`,children:[t.provider,"/",t.model]}),a.jsx("span",{className:`so-verd so-${t.verdict}`,role:"status",children:Sv(t.verdict)}),a.jsx("span",{className:"sp"}),a.jsx("button",{className:"mini",type:"button","data-tip":"Re-run second opinion","aria-label":`Re-run second opinion (${t.mode})`,onClick:()=>void Gn(e,{kind:"second_opinion",cardId:n.id,mode:t.mode}),children:"Re-run"}),a.jsx("button",{className:"ib",type:"button","data-tip":"Remove second opinion","aria-label":"Remove second opinion",onClick:()=>void Gn(e,{kind:"delete",targetId:`second-opinion:${n.id}:${t.mode}`}),children:a.jsx(q,{name:"trash"})})]}),a.jsx("div",{className:"so-b",children:t.blocks.map(c=>a.jsx(Ac,{block:c,level:"standard",threads:o,lookupPage:r,onOpenPage:s,onFollowUp:(d,u)=>i(n.id,d,u)},c.id))}),t.missed?a.jsxs("p",{className:"so-missed",children:[a.jsx("b",{children:"Missed: "}),t.missed]}):null]})}function Ev(e){return(e==null?void 0:e.kind)==="finding"?"blind":"check"}function jv(e){return e==="blind"?"Only the topic and the cited code":"The claim plus the cited code"}function Nh({reviewId:e,card:n,page:t}){const r=Ev(t),[s,i]=h.useState(null),[o,l]=h.useState(!1),c=h.useRef(null),d=h.useRef(null);h.useEffect(()=>{let A=!1;return T.settings().then(v=>{A||i(v)}).catch(()=>{}),()=>{A=!0}},[]),h.useEffect(()=>{if(!o)return;const A=x=>{var w;(w=c.current)!=null&&w.contains(x.target)||l(!1)},v=x=>{var w;x.key==="Escape"&&(l(!1),(w=d.current)==null||w.focus())};return document.addEventListener("pointerdown",A),document.addEventListener("keydown",v),()=>{document.removeEventListener("pointerdown",A),document.removeEventListener("keydown",v)}},[o]);const u=!s||s.secondOpinion.provider!==s.main.provider||s.secondOpinion.model!==s.main.model;if(s&&!u)return a.jsxs("span",{className:"so-ctl","data-so-ctl":n.id,children:[a.jsx("button",{className:"ib",type:"button","data-tip":"Second opinion needs a different model","aria-label":"Second opinion needs a different model",disabled:!0,children:a.jsx(q,{name:"spark"})}),a.jsxs("span",{className:"so-warn",role:"status",children:["Needs a different model — ",a.jsx(cn,{to:"/settings",children:"Settings"})]})]});const f=A=>{l(!1),Gn(e,{kind:"second_opinion",cardId:n.id,mode:A})},p=r==="blind"?"blind":"check this claim";return a.jsxs("span",{className:"so-ctl","data-so-ctl":n.id,children:[a.jsx("button",{className:"ib",type:"button","data-tip":`Second opinion (${p})`,"aria-label":`Second opinion (${p})`,onClick:()=>f(r),children:a.jsx(q,{name:"spark"})}),a.jsx("button",{ref:d,className:"ib",type:"button","data-tip":"Choose a second-opinion mode","aria-label":"Choose a second-opinion mode","aria-haspopup":"menu","aria-expanded":o,onClick:()=>l(A=>!A),children:a.jsx(q,{name:"down"})}),o?a.jsx("div",{ref:c,className:"so-menu",role:"menu","aria-label":"Second-opinion mode",children:["blind","check"].map(A=>a.jsxs("button",{type:"button",role:"menuitemradio","aria-checked":A===r,onClick:()=>f(A),children:[a.jsxs("span",{children:[A==="blind"?"Blind":"Check this claim",A===r?" (default)":""]}),a.jsx("span",{className:"hint",children:jv(A)})]},A))}):null]})}const yu=["simple","standard","deep"];function Le({icon:e,label:n,onClick:t,disabled:r,pressed:s}){return a.jsx("button",{className:"ib",type:"button","data-tip":n,"aria-label":n,"aria-pressed":s,disabled:r,onClick:t,children:a.jsx(q,{name:e})})}function Nv({text:e,stream:n}){return a.jsxs("div",{className:"working",role:"status",children:[a.jsxs("span",{className:"dots","aria-hidden":"true",children:[a.jsx("i",{}),a.jsx("i",{}),a.jsx("i",{})]}),a.jsx("span",{children:e}),n?a.jsx("span",{className:"stream",children:n.slice(-160)}):null]})}function Lv(e){return e instanceof Error?e.message:String(e)}function Go(e){return kh(Lv(e))}function gc({reviewId:e,expansion:n,lookupPage:t,onOpenPage:r,onFollowUp:s}){var R;const i=D(O=>O.snapshot),o=D(O=>O.streams),l=(i==null?void 0:i.jobs)??[],c=n.expansion;if(n.type!=="expansion"||!c)return null;const d=so(n),u=hh(l,n.id),f=o[n.id],p=n.working??c.working??(u==null?void 0:u.progress)??(f?f.slice(-160):void 0),A=!!u||!!f||!!p,v=n.error??c.error??null,x=kh(v),w=yu.indexOf(c.level),g=w<0?1:w,m=(((R=c.undoStack)==null?void 0:R.length)??0)>0,k=O=>{Gn(e,O).catch(_=>{Go(_)?F(_o):F(`Action failed: ${V(_)}`)})},b=()=>{T.action(e,{kind:"retry",threadId:n.id}).catch(O=>{T.action(e,{kind:"explain",quote:n.anchor.quotedText,anchor:Tv(n)}).catch(_=>{Go(_)||Go(O)?F(_o):F(`Retry failed: ${V(_)}`)})})},y=()=>{T.action(e,{kind:"promote",annotationId:n.id}).then(O=>{O.accepted&&O.pageId?r(O.pageId):O.accepted||F("Needs the service to open this as a page.")}).catch(O=>{F(`Couldn't open as a page: ${V(O)}`)})},C=()=>{T.action(e,{kind:"delete",targetId:n.id}).catch(O=>{F(`Couldn't delete: ${V(O)}`)})},S=()=>{T.action(e,{kind:"close",annotationId:n.id}).catch(()=>{T.updateComment(e,n.id,{open:!1}).catch(()=>{})})},N=()=>{T.updateComment(e,n.id,{open:!0}).catch(O=>{F(`Couldn't expand: ${V(O)}`)})};if(d)return a.jsx("section",{className:"card child collapsed",id:`B-${n.id}`,"data-expansion":n.id,children:a.jsxs("div",{className:"exp-h",children:[a.jsx(Le,{icon:"right",label:"Expand",onClick:N}),n.anchor.quotedText?a.jsx("q",{children:n.anchor.quotedText}):null,a.jsx("span",{className:"hint",children:"Anchor text not found"}),a.jsx("span",{className:"sp"}),a.jsx(Le,{icon:"open",label:"Open as page",onClick:y}),a.jsx(Le,{icon:"trash",label:"Delete",onClick:C}),a.jsx(Le,{icon:"x",label:"Close",onClick:S})]})});if(c.collapsed)return a.jsx("section",{className:`card child collapsed${c.read?" read":""}`,id:`B-${n.id}`,"data-expansion":n.id,children:a.jsxs("div",{className:"exp-h",children:[a.jsx(Le,{icon:"right",label:"Expand",onClick:()=>k({kind:"collapse",cardId:n.id,collapsed:!1})}),n.anchor.quotedText?a.jsx("q",{children:n.anchor.quotedText}):null,a.jsx("span",{className:"sp"}),a.jsx(Le,{icon:"open",label:"Open as page",onClick:y}),a.jsx(Le,{icon:"trash",label:"Delete",onClick:C}),c.read?a.jsx(Le,{icon:"check",label:"Mark unread",pressed:!0,onClick:()=>k({kind:"read",cardId:n.id,read:!1})}):a.jsx(Le,{icon:"x",label:"Close",onClick:S})]})});const M=c.secondOpinions??[];return a.jsxs("section",{className:`card child${c.read?" read":""}`,id:`B-${n.id}`,"data-expansion":n.id,children:[a.jsxs("div",{className:"exp-h",children:[n.anchor.quotedText?a.jsx("q",{children:n.anchor.quotedText}):null,a.jsx("span",{className:"sp"}),a.jsx(Le,{icon:"open",label:"Open as page",onClick:y}),a.jsx(Le,{icon:"trash",label:"Delete",onClick:C}),a.jsx(Le,{icon:"x",label:"Close",onClick:S})]}),a.jsxs("div",{className:"ctl",children:[a.jsxs("span",{className:"depth",role:"group","aria-label":"Depth",children:[a.jsx("button",{type:"button","data-tip":"Simpler","aria-label":"Simpler",disabled:g<=0,onClick:()=>k({kind:"depth",cardId:n.id,direction:"simpler"}),children:"−"}),a.jsx("span",{className:"dl","data-tip":"Depth",children:a.jsx("span",{className:"pips","aria-hidden":"true",children:yu.map((O,_)=>a.jsx("i",{className:_<=g?"on":""},_))})}),a.jsx("button",{type:"button","data-tip":"Deeper","aria-label":"Deeper",onClick:()=>k({kind:"depth",cardId:n.id,direction:"deeper"}),children:"+"})]}),a.jsx(Le,{icon:"bulb",label:"Use examples",onClick:()=>k({kind:"examples",cardId:n.id})}),a.jsx(Le,{icon:"diagram",label:"Add diagram",onClick:()=>k({kind:"diagram",cardId:n.id})}),a.jsx(Le,{icon:"undo",label:"Undo",disabled:!m,onClick:()=>k({kind:"undo",cardId:n.id})}),a.jsx(Rv,{reviewId:e,expansion:n,lookupPage:t}),a.jsx("span",{className:"sp"}),a.jsx(Le,{icon:"check",label:c.read?"Mark unread":"Mark read",pressed:c.read,onClick:()=>k({kind:"read",cardId:n.id,read:!c.read})})]}),A&&!v?a.jsx(Nv,{text:p??"Working…",stream:f}):null,x?a.jsx("div",{className:"perr",role:"status",children:a.jsx("span",{children:_o})}):null,v&&!x?a.jsxs("div",{className:"perr",role:"alert",children:[a.jsxs("span",{children:["Couldn't get an answer: ",v]}),a.jsx("button",{className:"btn",type:"button","data-retry":n.id,onClick:b,children:"Retry"})]}):null,a.jsx("div",{className:"exp-b",children:c.blocks.map(O=>a.jsx(h.Fragment,{children:a.jsx(Ac,{block:O,level:c.level,threads:[],lookupPage:t,onOpenPage:r,onFollowUp:(_,ae)=>s(n.id,_,ae)})},O.id))}),M.map(O=>a.jsx(jh,{reviewId:e,card:{id:n.id},result:O,lookupPage:t,onOpenPage:r,onFollowUp:(_,ae,le)=>s(_,ae,le)},O.id))]})}function Tv(e){const n=e.anchor.host;return n.kind==="block"?{where:"block",blockId:n.blockId}:n.kind==="description"?{where:"description",paragraphId:n.paragraphId}:{where:"diff-line",fileKey:n.fileKey,line:n.line}}function Rv({reviewId:e,expansion:n,lookupPage:t}){return a.jsx(Nh,{reviewId:e,card:{id:n.id},page:void 0})}const bu=["simple","standard","deep"];function bt({icon:e,label:n,onClick:t,disabled:r,pressed:s}){return a.jsx("button",{className:"ib",type:"button","data-tip":n,"aria-label":n,"aria-pressed":s,disabled:r,onClick:t,children:a.jsx(q,{name:e})})}function Cu({text:e}){return a.jsxs("div",{className:"working",role:"status",children:[a.jsxs("span",{className:"dots","aria-hidden":"true",children:[a.jsx("i",{}),a.jsx("i",{}),a.jsx("i",{})]}),a.jsx("span",{children:e})]})}function Bn(e,n){Gn(e,n).catch(()=>{})}function Su(e,n,t,r){const s=r();Gn(e,{kind:t,cardId:n}).then(i=>{if(!i.jobId||s===void 0)return;const o=i.jobId,l=window.setInterval(()=>{const c=D.getState().snapshot,d=c==null?void 0:c.jobs.find(u=>u.id===o);if(!(!d||d.state==="running"||d.state==="queued"||d.state==="backing-off")&&(window.clearInterval(l),d.state==="done")){const u=r();u!==void 0&&u===s&&F("Nothing more to add to this card.")}},500);window.setTimeout(()=>window.clearInterval(l),12e4)}).catch(()=>{})}function Eu(e,n){const t=D.getState().snapshot;for(const s of(t==null?void 0:t.pages)??[]){const i=s.cards.find(o=>o.id===n);if(i)return i.revision}const r=t==null?void 0:t.annotations.find(s=>s.id===n);if((r==null?void 0:r.type)==="expansion"&&r.expansion)return r.expansion.revision}function Pv({reviewId:e,card:n,lookupPage:t,onOpenPage:r,onFollowUp:s}){const i=D(w=>w.snapshot),o=(i==null?void 0:i.jobs)??[],l=(i==null?void 0:i.annotations)??[],c=D(w=>w.streams),d=(i==null?void 0:i.contributions)??[],u=hh(o,n.id),f=c[n.id],p=(u==null?void 0:u.progress)??(f?f.slice(-160):void 0);if(n.pending)return a.jsx("section",{className:"card pend",id:`C-${n.id}`,children:u||f?a.jsx(Cu,{text:p??"Working…"}):a.jsxs(a.Fragment,{children:[a.jsx("div",{className:"pl",children:n.pending.label}),a.jsx("div",{className:"why",children:n.pending.why}),a.jsx("button",{className:"go",type:"button","data-gen":n.id,onClick:()=>Bn(e,{kind:"generate",cardId:n.id}),children:"Generate"})]})});const A=bu.indexOf(n.level),v=w=>r2(l,n.id,w),x=n.blocks.map(w=>{const g=Z2(l,n.id,w.id),m=g.filter(V2),k=g.filter(K2),b=g.filter(_2);return a.jsxs(h.Fragment,{children:[a.jsx(Ac,{block:w,level:n.level,threads:v(w.id),lookupPage:t,onOpenPage:r,onFollowUp:(y,C)=>s(n.id,y,C)}),a.jsx(W2,{reviewId:e,cardId:n.id,blockId:w.id}),m.map(y=>a.jsx(gc,{reviewId:e,expansion:y,lookupPage:t,onOpenPage:r,onFollowUp:s},y.id)),k.map(y=>a.jsxs("div",{className:"linkstub","data-fallback":y.id,hidden:!0,children:["↳"," ",a.jsx("button",{type:"button",onClick:()=>Bn(e,{kind:"collapse",cardId:n.id,collapsed:!1}),children:y.anchor.quotedText||"Show explanation"}),a.jsx("span",{className:"hint",children:"click the dotted link to expand"})]},y.id)),b.map(y=>a.jsxs("div",{className:"linkstub","data-fallback":y.id,hidden:!0,children:["↳"," ",a.jsx("button",{type:"button","data-node":y.promotedToPage??"",onClick:()=>y.promotedToPage&&r(y.promotedToPage),children:y.anchor.quotedText||"Opened as its own page"}),a.jsx("span",{className:"hint",children:"opened as its own page"})]},y.id))]},w.id)});return n.collapsed?a.jsx("section",{className:`card collapsed${n.read?" read":""}`,id:`C-${n.id}`,children:a.jsxs("div",{className:"chead",children:[a.jsx(bt,{icon:"right",label:"Expand",onClick:()=>Bn(e,{kind:"collapse",cardId:n.id,collapsed:!1})}),n.title?a.jsx("h2",{className:"ct",children:n.title}):a.jsx("p",{className:"cprev",children:dc(n)}),n.read?a.jsx(bt,{icon:"check",label:"Mark unread",pressed:!0,onClick:()=>Bn(e,{kind:"read",cardId:n.id,read:!1})}):null]})}):a.jsxs("section",{className:`card${n.read?" read":""}`,id:`C-${n.id}`,children:[a.jsxs("div",{className:"chead",children:[a.jsx(bt,{icon:"down",label:"Collapse",onClick:()=>Bn(e,{kind:"collapse",cardId:n.id,collapsed:!0})}),n.title?a.jsx("h2",{className:"ct",children:n.title}):null]}),n.stale?a.jsxs("div",{className:"stale",role:"status",children:[a.jsxs("span",{children:[n.staleChangedHunks??0," cited"," ",(n.staleChangedHunks??0)===1?"hunk":"hunks"," changed"]}),a.jsx("button",{className:"x",type:"button",onClick:()=>J2(e),children:"Update"})]}):null,a.jsxs("div",{className:"ctl",children:[a.jsxs("span",{className:"depth",role:"group","aria-label":"Depth",children:[a.jsx("button",{type:"button","data-tip":"Simpler","aria-label":"Simpler",disabled:A<=0,onClick:()=>Bn(e,{kind:"depth",cardId:n.id,direction:"simpler"}),children:"−"}),a.jsx("span",{className:"dl","data-tip":"Depth",children:a.jsx("span",{className:"pips","aria-hidden":"true",children:bu.map((w,g)=>a.jsx("i",{className:g<=A?"on":""},g))})}),a.jsx("button",{type:"button","data-tip":"Deeper","aria-label":"Deeper",onClick:()=>Bn(e,{kind:"depth",cardId:n.id,direction:"deeper"}),children:"+"})]}),a.jsx(bt,{icon:"bulb",label:"Use examples",onClick:()=>Su(e,n.id,"examples",()=>Eu(e,n.id))}),a.jsx(bt,{icon:"diagram",label:"Add diagram",onClick:()=>Su(e,n.id,"diagram",()=>Eu(e,n.id))}),a.jsx(bt,{icon:"undo",label:"Undo",disabled:n.undoStack.length===0,onClick:()=>Bn(e,{kind:"undo",cardId:n.id})}),a.jsx(Nh,{reviewId:e,card:n,page:t(n.pageId)}),a.jsx("span",{className:"sp"}),a.jsx(bt,{icon:"check",label:n.read?"Mark unread":"Mark read",pressed:n.read,onClick:()=>Bn(e,{kind:"read",cardId:n.id,read:!n.read})})]}),u||f?a.jsx(Cu,{text:p??"Working…"}):null,x,a.jsx(Cv,{reviewId:e,card:n,contributions:d}),(n.secondOpinions??[]).map(w=>a.jsx(jh,{reviewId:e,card:n,result:w,lookupPage:t,onOpenPage:r,onFollowUp:(g,m,k)=>s(g,m,k)},w.id))]})}function Mv(e){return e.saved||e.kind==="concept"}function Bv({page:e}){if(e.kind!=="finding")return null;const{needsRecheck:n,recheckStatus:t,recheckNote:r}=e;if(!n&&!t)return null;const s=t==="still-applies"?"Rechecked · still applies":t==="resolved"?"Rechecked · resolved":t==="changed"?"Rechecked · changed":"Cited code changed · awaiting recheck";return a.jsxs("div",{className:"meta","data-recheck":t??"pending",children:[a.jsx("span",{children:s}),r?a.jsx("span",{children:r}):null]})}function Dv({reviewId:e,page:n,lookupPage:t,onOpenPage:r,onJumpToCard:s}){const[i,o]=h.useState(!0),l=n.kind==="finding",c=Mv(n),d=D(y=>{var C;return(C=y.snapshot)==null?void 0:C.pages}),u=D(y=>{var C;return((C=y.snapshot)==null?void 0:C.jobs)??[]}),f=D(y=>y.streams),p=D(y=>{var C;return((C=y.snapshot)==null?void 0:C.contributions)??[]}),{cards:A,links:v}=J0(n,t,d),x=[];{const y=new Set;let C=n;for(;C&&!y.has(C.id);)y.add(C.id),x.unshift(C),C=C.parent?t(C.parent):void 0}const w=n.kind==="root"?"Guided review":l?`Agent finding · ${n.confidence??""} confidence`:"",g=n.cards.findIndex(y=>y.pending),m=(()=>{if(n.kind!=="concept"&&n.kind!=="opened-expansion")return null;const y=n.cards[0];if(!y||y.blocks.length>0)return null;const C=u.find(N=>{var M;return(N.cardId===y.id||((M=N.dedupeKey)==null?void 0:M.includes(`concept:${n.id.slice(2)}`)))&&(N.state==="running"||N.state==="queued")}),S=f[y.id];return!C&&!S?null:(C==null?void 0:C.progress)??(S?S.slice(-160):"Writing the concept page…")})(),k=p.filter(y=>y.items.some(C=>C.kind==="fact"||C.kind==="open_question")).length,b=(y,C)=>a.jsxs(h.Fragment,{children:[C===g?a.jsx("div",{className:"divider",children:"Go deeper"}):null,a.jsx(Pv,{reviewId:e,card:y,lookupPage:t,onOpenPage:S=>r(S),onFollowUp:(S,N,M)=>mc(e,S,N,M)})]},y.id);return a.jsxs("div",{className:`doc${l?" finding":""}`,children:[x.length>1?a.jsx("nav",{className:"crumbs","aria-label":"Trail",children:x.map((y,C)=>C===x.length-1?a.jsx("span",{children:y.title},y.id):a.jsxs("span",{children:[a.jsx("button",{type:"button",onClick:()=>r(y.id==="root"?null:y.id),children:y.title}),a.jsx("span",{children:" › "})]},y.id))}):null,a.jsxs("div",{className:`eyebrow${l?" find":""}`,children:[w,a.jsx("button",{className:"ib save",type:"button","data-tip":c?"Saved to this repo · click to unsave":"Save to this repo","aria-label":c?"Saved to this repo · click to unsave":"Save to this repo","aria-pressed":c,"data-save":n.id,onClick:()=>void Gn(e,{kind:"bookmark",pageId:n.id,saved:!c}),children:a.jsx(q,{name:"bookmark"})})]}),a.jsx("h1",{className:"title",children:n.title}),l&&n.summary?a.jsx("div",{className:"meta",children:n.summary}):null,a.jsx(Bv,{page:n}),m?a.jsxs("div",{className:"working",role:"status",children:[a.jsxs("span",{className:"dots","aria-hidden":"true",children:[a.jsx("i",{}),a.jsx("i",{}),a.jsx("i",{})]}),a.jsx("span",{children:m})]}):null,k>0?a.jsxs("p",{className:"hint","data-shared-indicator":!0,children:[k," shared context ",k===1?"item":"items"," from this review ·"," ",a.jsx(cn,{to:`/settings?review=${encodeURIComponent(e)}#shared-context`,children:"Settings → Shared context"})]}):null,a.jsxs("nav",{className:"toc","aria-label":"Contents",children:[a.jsxs("div",{className:"toc-h",children:[a.jsx("button",{className:"ib",type:"button","data-tip":i?"Hide contents":"Show contents","aria-label":i?"Hide contents":"Show contents","data-toc":"",onClick:()=>o(y=>!y),children:a.jsx(q,{name:i?"down":"right"})}),a.jsx("span",{children:"Contents"})]}),i?a.jsxs("div",{className:"toc-g",children:[a.jsxs("div",{children:[a.jsx("h3",{children:"On this page"}),a.jsx("ul",{children:A.map(y=>a.jsx("li",{className:y.read?"done":"",children:a.jsx("button",{type:"button","data-tocard":y.id,onClick:()=>s(y.id),children:a.jsx("span",{className:"tt",children:y.title})})},y.id))})]}),v.length?a.jsxs("div",{children:[a.jsx("h3",{children:"Linked pages"}),a.jsx("ul",{children:v.map(y=>a.jsx("li",{className:y.read?"done":"",children:a.jsx("button",{type:"button","data-node":y.id,onClick:()=>r(y.id),children:a.jsx("span",{className:"tt",children:y.title})})},y.id))})]}):null]}):null]}),n.cards.map(b)]})}function Fv(e){if(!e)return null;const n=e.match(/^page\/([^/]+)$/);return n?decodeURIComponent(n[1]):null}function Iv({reviewId:e}){const n=D(x=>x.snapshot),t=D(x=>x.setSnapshot),r=rc()["*"],s=Qn(),i=Vt(),o=ro();h.useEffect(()=>{let x=!1;return T.review(e,o).then(w=>{x||t(w)}).catch(()=>{}),()=>{x=!0}},[e,o,t]);const l=Fv(r),c=l??"root",d=h.useRef(new Map);h.useEffect(()=>{const x=document.getElementById("page");if(!x)return;const w=()=>{d.current.set(c,x.scrollTop)};return x.addEventListener("scroll",w,{passive:!0}),()=>x.removeEventListener("scroll",w)},[c]),h.useEffect(()=>{const x=d.current.get(c),w=document.getElementById("page");if(!w)return;const g=window.setTimeout(()=>{w.scrollTop=x??0},0);return()=>window.clearTimeout(g)},[c]);const u=h.useCallback(x=>{s(x===null?`/review/${e}`:`/review/${e}/page/${encodeURIComponent(x)}`)},[s,e]),f=h.useCallback(x=>{const w=D.getState().snapshot,g=w==null?void 0:w.pages.flatMap(m=>m.cards).find(m=>m.id===x);g!=null&&g.collapsed&&Gn(e,{kind:"collapse",cardId:x,collapsed:!1}),window.setTimeout(()=>{const m=document.getElementById(`C-${x}`);if(!m)return;const k=window.matchMedia("(prefers-reduced-motion: reduce)").matches;m.scrollIntoView({block:"start",behavior:k?"auto":"smooth"})},g!=null&&g.collapsed?80:0)},[e]);h.useEffect(()=>{const x=w=>{const{cardId:g,blockId:m}=w.detail;Y2(u,l??"root",g,m)};return window.addEventListener(sl,x),()=>window.removeEventListener(sl,x)},[u,l]),h.useEffect(()=>{const x=i.hash.replace(/^#/,"");if(!n||!/^C-/.test(x))return;let w=0;const g=window.setInterval(()=>{const m=document.getElementById(x);m?(m.scrollIntoView({block:"start"}),window.clearInterval(g)):++w>20&&window.clearInterval(g)},150);return()=>window.clearInterval(g)},[n,i.hash]);const p=n==null?void 0:n.pages,A=h.useCallback(x=>p==null?void 0:p.find(w=>w.id===x),[p]);if(!n||!p)return a.jsxs("div",{className:"doc",children:[a.jsx("div",{className:"eyebrow",children:"Guided review"}),a.jsxs("h1",{className:"title",children:["Review ",e]}),a.jsx("p",{className:"hint",children:"Loading the guide…"})]});const v=l===null?p.find(x=>x.kind==="root")??p[0]:A(l);return v?a.jsxs(a.Fragment,{children:[a.jsx(vu,{}),a.jsx(Dv,{reviewId:e,page:v,lookupPage:A,onOpenPage:u,onJumpToCard:f})]}):a.jsxs(a.Fragment,{children:[a.jsx(vu,{}),a.jsxs("div",{className:"doc",children:[a.jsx("div",{className:"eyebrow",children:"Guided review"}),a.jsx("h1",{className:"title",children:"Page not found"}),a.jsxs("p",{className:"hint",children:["There is no page ",a.jsx("code",{children:l})," in this review."," ",a.jsx("button",{type:"button",className:"x",onClick:()=>u(null),children:"Back to the guided review"})]})]})]})}const Ov=e=>e.replace(/<[^>]+>/g,"");function Hv(e){const n=e.messages[0];return Ov((n==null?void 0:n.text)??(n==null?void 0:n.html)??"").slice(0,140)}function zv(e,n){var t;return((t=e.files.find(r=>r.fileKey===n))==null?void 0:t.path)??null}function Uv(e,n){const t=no(n);if(!t||t.kind!=="diff")return null;const r=zv(e,t.fileKey),s=(r==null?void 0:r.split("/").pop())??t.fileKey;return t.start===t.end?`${s}:${t.start}`:`${s}:${t.start}`}function Wv(e,n){for(const t of e.pages??[])for(const r of t.cards??[])for(const s of r.blocks??[]){const i=s;if(i.id===n)return(i.citations??[]).map(o=>o.target)}return[]}function Vv(e,n){const t=n.anchor.host;if(t.kind==="diff-line"){const r=e.files.find(i=>i.fileKey===t.fileKey);return`${(r==null?void 0:r.path.split("/").pop())??t.fileKey}:${t.line}`}if(t.kind==="block"){const r=t.blockId.indexOf("#"),s=r>=0?t.blockId.slice(r+1):t.blockId;for(const i of[t.blockId,s]){const o=Wv(e,i).find(l=>l.startsWith("diff:"));if(o){const l=Uv(e,o);if(l)return l}}return"General PR comment"}return"General PR comment"}function Kv(e,n){const t=n.anchor.host;if(t.kind==="diff-line"){const r=e.files.find(s=>s.fileKey===t.fileKey);return(r==null?void 0:r.path)??t.fileKey}if(t.kind==="description")return"PR description";for(const r of e.pages)for(const s of r.cards)for(const i of s.blocks){const o=i;if(o.id&&xr(t.kind==="block"?t.blockId:"",s.id,o.id)){const l=r.title.length>34?`${r.title.slice(0,33)}…`:r.title;return s.title?`${l} › ${s.title}`:l}}return"Guide"}function _v({reviewId:e,thread:n,readOnly:t}){const r=n.draft??cv(n),[s,i]=h.useState(r),o=h.useRef(void 0);h.useEffect(()=>{n.draft!==void 0&&i(n.draft)},[n.draft]);const l=h.useRef(s);l.current=s;const c=h.useRef(n.draft);return c.current=n.draft,h.useEffect(()=>()=>{window.clearTimeout(o.current);const d=l.current;d!==c.current&&T.updateComment(e,n.id,{draft:d}).catch(()=>{})},[e,n.id]),a.jsx("textarea",{id:`ob-${n.id}`,"aria-label":"Draft PR comment",value:s,readOnly:t,title:t?"Viewing an older version · read-only":void 0,onChange:d=>{i(d.target.value),window.clearTimeout(o.current);const u=d.target.value;o.current=window.setTimeout(()=>{T.updateComment(e,n.id,{draft:u}).catch(f=>{F(`Couldn't save the draft: ${V(f)}`)})},400)}})}function Gv({reviewId:e}){const n=D(w=>w.snapshot),t=Cr(),[r,s]=h.useState(!1),[i,o]=h.useState("all"),[l,c]=h.useState(null),d=Qn(),u=h.useRef(null),f=h.useMemo(()=>((n==null?void 0:n.annotations)??[]).filter(w=>w.type==="thread"&&w.messages.length>0),[n]),p=h.useMemo(()=>f.filter(w=>w.post),[f]),A=(n==null?void 0:n.existingComments)??l??null;h.useEffect(()=>{!r||!n||n.existingComments||n.review.prNumber&&T.prComments(e).then(w=>c(w.comments)).catch(()=>{})},[r,n,e]),h.useEffect(()=>{if(!r)return;const w=m=>{m.key==="Escape"&&s(!1)},g=m=>{var k;(k=u.current)!=null&&k.contains(m.target)||s(!1)};return document.addEventListener("keydown",w),document.addEventListener("pointerdown",g,!0),()=>{document.removeEventListener("keydown",w),document.removeEventListener("pointerdown",g,!0)}},[r]);const v=w=>{const g=D.getState().snapshot;if(!g)return;s(!1),T.updateComment(e,w.id,{open:!0}).catch(()=>{});const m=w.anchor.host;if(m.kind==="diff-line"){Cn(`diff:${m.fileKey}:${m.line}`),window.setTimeout(()=>{var y;(y=document.getElementById(w.id))==null||y.scrollIntoView({block:"nearest"})},300);return}if(m.kind==="description"){window.dispatchEvent(new CustomEvent(Ht,{detail:{ref:`desc:${m.paragraphId}`}})),window.setTimeout(()=>{const y=document.getElementById(w.id)??document.getElementById(m.paragraphId);y==null||y.scrollIntoView({block:"center"})},200);return}const k=g.pages.flatMap(y=>y.cards.map(C=>({page:y,card:C}))).find(({card:y})=>y.blocks.some(C=>xr(m.blockId,y.id,C.id)));if(!k)return;const b=()=>{k.card.collapsed&&T.action(e,{kind:"collapse",cardId:k.card.id,collapsed:!1}).catch(()=>{}),window.setTimeout(()=>{const y=m.blockId.includes("#")?m.blockId.split("#")[1]:m.blockId;hc(k.card.id,y),window.setTimeout(()=>{var C;(C=document.getElementById(w.id))==null||C.scrollIntoView({block:"center"})},200)},120)};k.page.kind==="root"?d(`/review/${e}`):d(`/review/${e}/page/${encodeURIComponent(k.page.id)}`),b()},x=i==="pr"?p:f;return a.jsxs("span",{ref:u,style:{position:"relative"},children:[a.jsxs("button",{className:"tbtn",type:"button","data-cm":"","aria-expanded":r,onClick:()=>s(w=>!w),children:[a.jsx(q,{name:"comment"}),"Comments ",f.length,p.length>0?a.jsxs("span",{className:"count",children:[p.length," for PR"]}):null]}),r&&n?a.jsxs("div",{className:"cmenu",role:"dialog","aria-label":"Comments",children:[a.jsxs("div",{className:"frow",children:[a.jsxs("span",{className:"seg",children:[a.jsxs("button",{type:"button","data-cmf":"all","aria-pressed":i==="all",onClick:()=>o("all"),children:["All ",f.length]}),a.jsxs("button",{type:"button","data-cmf":"pr","aria-pressed":i==="pr",onClick:()=>o("pr"),children:["For PR ",p.length]})]}),a.jsx("span",{className:"sp"}),a.jsx("button",{className:"ib",type:"button","data-tip":"Close","aria-label":"Close","data-cmclose":"",onClick:()=>s(!1),children:a.jsx(q,{name:"x"})})]}),x.map(w=>{const g=Kv(n,w);return a.jsxs("div",{className:"ci",children:[a.jsxs("button",{className:"cj",type:"button","data-cjump":w.id,onClick:()=>v(w),children:[a.jsx("span",{className:"cw",children:i==="pr"?`${Vv(n,w)} · from ${g}`:g}),a.jsx("span",{className:"cx2",children:Hv(w)})]}),w.post?a.jsx("span",{className:"prtag",children:"For PR"}):null,i==="pr"?a.jsx(_v,{reviewId:e,thread:w,readOnly:t}):null]},w.id)}),x.length===0?a.jsx("p",{className:"hint",style:{margin:4},children:i==="pr"?"Nothing marked for the PR yet. Use “For PR” on any comment.":"No comments yet. Select text and choose Ask or Note."}):null,i==="pr"&&p.length>0?a.jsx("span",{className:"hint",children:"These are drafts. Nothing reaches GitHub until you use Submit review."}):null,a.jsxs("div",{children:[a.jsx("h3",{className:"hint",style:{margin:"6px 0 2px"},children:"Already on GitHub"}),A===null?a.jsx("p",{className:"hint",style:{margin:4},children:"Loading existing comments…"}):A.length===0?a.jsx("p",{className:"hint",style:{margin:4},children:"No existing review comments."}):A.map(w=>a.jsx("div",{className:"ci",children:a.jsxs("span",{className:"cj",children:[a.jsxs("span",{className:"cw",children:[w.path??"General",w.line?`:${w.line}`:""," · ",w.author??"GitHub"]}),a.jsx("span",{className:"cx2",children:w.body.slice(0,140)})]})},`existing-${w.id}`))]})]}):null]})}const qv=h.createContext({});function Qv(){return h.useContext(qv)}function xn(e,n){return`${e}:${n}`}function Zv(e){const n=D(d=>{var u;return(u=d.snapshot)==null?void 0:u.annotations}),t=Cr(),[r,s]=h.useState(null);h.useEffect(()=>{const d=u=>{const f=u.detail;f.anchor.where==="diff-line"&&(mt()||s({fileKey:f.anchor.fileKey,line:f.anchor.line,quote:f.quote,note:f.note}))};return window.addEventListener(Ot,d),()=>window.removeEventListener(Ot,d)},[]);const i=h.useMemo(()=>{const d=new Map;for(const u of n??[]){if(u.type!=="thread")continue;const f=u,p=f.anchor.host;if(p.kind!=="diff-line")continue;const A=xn(p.fileKey,p.line),v=d.get(A)??[];v.push(f),d.set(A,v)}return d},[n]),o=h.useCallback((d,u)=>{if(mt()){F("Viewing an older version · read-only");return}const f=xn(d,u),p=i.get(f)??[],A=D.getState().snapshot,v=(A==null?void 0:A.review.id)??e;if(p.length>0){const x=p.filter(w=>!w.open);if(x.length>0)for(const w of x)T.updateComment(v,w.id,{open:!0}).catch(g=>{F(`Couldn't open the comment: ${V(g)}`)});window.setTimeout(()=>{var w;(w=document.getElementById(p[0].id))==null||w.scrollIntoView({block:"nearest"})},60);return}s({fileKey:d,line:u,quote:"",note:!1})},[i,e]),l=h.useMemo(()=>{const d={};for(const[u,f]of i){const p=f.filter(A=>A.open);p.length!==0&&(d[u]=a.jsxs(a.Fragment,{children:[p.map(A=>a.jsx(Ii,{reviewId:e,thread:A,readOnly:t},A.id)),r&&!t&&xn(r.fileKey,r.line)===u?a.jsx(Di,{reviewId:e,anchor:{where:"diff-line",fileKey:r.fileKey,line:r.line},quote:r.quote,note:r.note,onDiscard:()=>s(null),onCreated:()=>s(null)},"pending"):null]}))}return r&&!t&&!d[xn(r.fileKey,r.line)]&&(d[xn(r.fileKey,r.line)]=a.jsx(Di,{reviewId:e,anchor:{where:"diff-line",fileKey:r.fileKey,line:r.line},quote:r.quote,note:r.note,onDiscard:()=>s(null),onCreated:()=>s(null)},"pending")),d},[i,r,e,t]),c=h.useMemo(()=>new Set(i.keys()),[i]);return{lineSlots:l,commentedLines:c,onLineClick:o}}function Yv(e,n){const t=document.createElement("mark");return t.className=n?"anc exl":"anc ex",t.dataset.jump=e,t}function Xv(e,n,t,r){const s=D(c=>{var d;return(d=c.snapshot)==null?void 0:d.annotations}),i=h.useMemo(()=>{const c=new Map;for(const d of s??[]){if(d.type!=="expansion"&&d.type!=="link"||d.anchor.host.kind!=="diff-line"||d.type==="link")continue;const u=xn(d.anchor.host.fileKey,d.anchor.host.line),f=c.get(u)??[];f.push(d),c.set(u,f)}return c},[s]);h.useEffect(()=>{const c=window.setTimeout(()=>{const d=document.body;Ss(d,()=>{for(const[u,f]of i){const[p,A]=u.split(":"),v=document.getElementById(`L-${p}-${A}`);if(v)for(const x of v.querySelectorAll("td.c")){Cs(x,"mark.anc.ex[data-jump], mark.anc.exl[data-jump]");for(const w of f)if(!(so(w)||!w.anchor.quotedText))try{fc(x,w.anchor.quotedText,()=>Yv(w.id,!w.open))}catch{}}}})},0);return()=>window.clearTimeout(c)},[i,s]),h.useEffect(()=>{const c=d=>{var v,x;const u=(x=(v=d.target)==null?void 0:v.closest)==null?void 0:x.call(v,"#right mark.anc[data-jump]");if(!u)return;const f=u.dataset.jump??"",p=D.getState().snapshot,A=p==null?void 0:p.annotations.find(w=>w.id===f);!A||A.anchor.host.kind!=="diff-line"||(A.type==="expansion"&&!A.open&&T.updateComment(e,f,{open:!0}).catch(w=>{F(`Couldn't expand: ${V(w)}`)}),window.setTimeout(()=>{var w;(w=document.getElementById(`B-${f}`))==null||w.scrollIntoView({block:"nearest"})},120))};return document.addEventListener("click",c),()=>document.removeEventListener("click",c)},[e]);const o=h.useMemo(()=>{const c={};for(const[d,u]of i){const f=u.filter(p=>p.type==="expansion"&&p.open);f.length!==0&&(c[d]=a.jsx(a.Fragment,{children:f.map(p=>a.jsx(gc,{reviewId:e,expansion:p,lookupPage:n,onOpenPage:t,onFollowUp:r},p.id))}))}return c},[i,e,n,t,r]),l=h.useMemo(()=>new Set(i.keys()),[i]);return{lineSlots:o,expandedLines:l}}let zr,Qs=null;function Jv(){if(zr!==void 0){const e=zr;return Promise.resolve(e)}if(!Qs){const e=T.viewer().then(n=>{const t=n.login;return zr=t,t}).catch(()=>(zr=null,null));Qs=e,e.finally(()=>{Qs=null})}return Qs}function Lh(){const[e,n]=h.useState(zr);return h.useEffect(()=>{let t=!1;return Jv().then(r=>{t||n(r)}),()=>{t=!0}},[]),e}function $v(e,n){const t=document.createElement("mark");return t.className=n?"anc exl":"anc ex",t.dataset.jump=e,t}function ex(e){const n=document.createElement("a");return n.className="cx pg",n.dataset.node=e,n.title="Opened as its own page",n}function nx({reviewId:e,paragraphId:n,lookupPage:t,onOpenPage:r,onFollowUp:s}){const i=D(d=>{var u;return(u=d.snapshot)==null?void 0:u.annotations}),[,o]=h.useState(0),l=(i??[]).filter(d=>(d.type==="expansion"||d.type==="link")&&d.anchor.host.kind==="description"&&d.anchor.host.paragraphId===n),c=l.filter(d=>d.type==="expansion"&&d.open&&!d.promotedToPage);return h.useEffect(()=>{const d=document.querySelector("#right .desc");if(!d||l.length===0)return;const u=window.setTimeout(()=>{Ss(d,()=>{Cs(d,"mark.anc.ex[data-jump], mark.anc.exl[data-jump], a.cx.pg[data-node]");let f=!1;for(const p of l){if(so(p)||!p.anchor.quotedText)continue;if(p.type==="link"||p.promotedToPage){const v=p.promotedToPage??"";v&&gs(d,n,p.anchor.quotedText,()=>ex(v))&&(f=!0);continue}const A=!p.open;gs(d,n,p.anchor.quotedText,()=>$v(p.id,A))&&(f=!0)}f&&o(p=>p+1)})},0);return()=>window.clearTimeout(u)},[i,n,l]),h.useEffect(()=>{const d=u=>{var x,w,g;const f=(w=(x=u.target)==null?void 0:x.closest)==null?void 0:w.call(x,"#right mark.anc[data-jump]");if(!f)return;const p=f.dataset.jump??"",A=D.getState().snapshot,v=A==null?void 0:A.annotations.find(m=>m.id===p);v&&(v.type==="expansion"&&!v.open?(T.updateComment(e,p,{open:!0}).catch(m=>{F(`Couldn't expand: ${V(m)}`)}),window.setTimeout(()=>{var m;(m=document.getElementById(`B-${p}`))==null||m.scrollIntoView({block:"nearest"})},120)):(g=document.getElementById(`B-${p}`))==null||g.scrollIntoView({block:"nearest"}))};return document.addEventListener("click",d),()=>document.removeEventListener("click",d)},[e]),c.length===0?null:a.jsx(a.Fragment,{children:c.map(d=>a.jsx("div",{className:"dann",children:a.jsx(gc,{reviewId:e,expansion:d,lookupPage:t,onOpenPage:r,onFollowUp:s})},d.id))})}function tx(e){return e.replace(/ contenteditable="(true|false)"/g,"").replace(/ id="descEdit"/g,"").replace(/ spellcheck="(true|false)"/g,"").replace('class="desc editing"','class="desc"').replace(/<div class="author">[\s\S]*?<\/div>/,"")}function rx({html:e,draftRef:n}){const t=h.useRef(null),r=h.useRef(e);return n.current=n.current||e,h.useEffect(()=>{var i;const s=t.current;s&&!s.innerHTML&&(s.innerHTML=r.current),(i=t.current)==null||i.focus()},[]),a.jsx("div",{className:"desc editing",id:"descEdit",ref:t,contentEditable:!0,spellCheck:!0,suppressContentEditableWarning:!0,onInput:s=>{n.current=s.target.innerHTML}})}function sx(e,n){return!e||e.source!=="pr"||e.state!==void 0&&e.state!==""&&e.state!=="OPEN"||e.author!==void 0&&n!=null&&n!==e.author?!1:e.editable}function ix(e){const n=[],t=/<(p|ul|ol|pre|h3)\b([^>]*)>([\s\S]*?)<\/\1>/gi;let r;for(;(r=t.exec(e))!==null;){const s=r[1].toLowerCase(),o=r[2].match(/\bid=["']([^"']+)["']/i);n.push({id:s==="h3"?null:(o==null?void 0:o[1])??null,tag:s,html:r[0]})}return n}function ox(e){return e.replace(/^[\s\S]*?<div class="desc"[^>]*>/i,"").replace(/<\/div>\s*$/,"")}function ax(e){return`<div class="desc">${e}</div>`}function lx(e){const n=document.createElement("mark");return n.className="anc",n.dataset.thr=e,n}function cx(e,n){if(e.size!==n.size)return!1;for(const t of e)if(!n.has(t))return!1;return!0}function dx({reviewId:e,editor:n}){const t=D(M=>{var R;return(R=M.snapshot)==null?void 0:R.description}),r=D(M=>{var R;return(R=M.snapshot)==null?void 0:R.annotations}),s=Cr(),i=Lh(),[o,l]=h.useState(!1),[c,d]=h.useState(null),[u,f]=h.useState(new Set),p=h.useRef(""),A=(t==null?void 0:t.pendingHtml)??(t==null?void 0:t.html)??"",v=h.useMemo(()=>ix(A),[A]),x=h.useMemo(()=>(r??[]).filter(M=>M.type==="thread"&&M.anchor.host.kind==="description"),[r]),w=h.useMemo(()=>{const M=new Map;for(const R of x){const O=R.anchor.host.kind==="description"?R.anchor.host.paragraphId:"",_=M.get(O)??[];_.push(R),M.set(O,_)}return M},[x]),g=h.useMemo(()=>new Set(v.map(M=>M.id).filter(M=>M!==null)),[v]),m=h.useMemo(()=>x.filter(M=>{const R=M.anchor.host.kind==="description"?M.anchor.host.paragraphId:"";return!g.has(R)}),[x,g]),k=h.useMemo(()=>(t==null?void 0:t.restated)??{},[t]);if(h.useEffect(()=>{const M=R=>{const O=R.detail;O.anchor.where==="description"&&(mt()||d(O))};return window.addEventListener(Ot,M),()=>window.removeEventListener(Ot,M)},[]),!t)return a.jsx("div",{className:"desc",children:a.jsxs("p",{className:"hint",children:["No description yet for review ",e,"."]})});const b=sx(t,i===void 0?null:i)&&!s,y=()=>{p.current=ox(A),l(!0)},C=()=>{const M=tx(ax(p.current));T.updateDescription(e,{html:M}).then(()=>l(!1)).catch(R=>{F(`Saving the description failed: ${V(R)}`)})},S=()=>{T.revertDescription(e).catch(M=>{F(`Couldn't revert the description: ${V(M)}`)})},N=t.author!==void 0||t.state!==void 0?`by ${t.author??"unknown"}${t.state?` · ${t.state}`:""}`:null;return a.jsxs(a.Fragment,{children:[N?a.jsxs("div",{className:"dbar",children:[a.jsx("span",{className:"hint",children:N}),a.jsx("span",{className:"sp"})]}):null,t.pendingHtml&&!o?a.jsxs("div",{className:"dbar",children:[a.jsx("span",{className:"hint",children:"Edited · goes to GitHub when you submit the review"}),a.jsx("span",{className:"sp"}),a.jsx("button",{className:"x",type:"button","data-descrevert":!0,onClick:S,children:"Revert edits"})]}):null,!b&&!o?a.jsxs("div",{className:"dbar",children:[a.jsx("span",{className:"hint",children:t.source==="commits"?"Commit messages for a branch without a PR. The tab is read-only.":"You're reviewing someone else's PR, so the description is read-only."}),a.jsx("span",{className:"sp"})]}):null,b&&!o?a.jsxs("div",{className:"dbar",children:[a.jsx("span",{className:"sp"}),a.jsx("button",{className:"x",type:"button","data-descedit":!0,onClick:y,children:"Edit description"})]}):null,o?a.jsxs(a.Fragment,{children:[a.jsxs("div",{className:"dbar",children:[a.jsx("span",{className:"hint",children:"Editing the description. Type directly in the text below."}),a.jsx("span",{className:"sp"}),a.jsx("button",{className:"btn ghost",type:"button","data-descdiscard":!0,onClick:()=>l(!1),children:"Discard"}),a.jsx("button",{className:"btn",type:"button","data-descsave":!0,onClick:C,children:"Save"})]}),n?a.jsx("div",{className:"desc",children:n.render({html:A,onSave:M=>{T.updateDescription(e,{html:M}).then(()=>l(!1)).catch(R=>{F(`Saving the description failed: ${V(R)}`)})},onDiscard:()=>l(!1)})}):a.jsx(rx,{html:A,draftRef:p})]}):a.jsx(ux,{reviewId:e,segments:v,byPara:w,orphans:m,highlighted:u,setHighlighted:f,pending:c,setPending:d,restated:k,readOnly:s})]})}const ux=h.forwardRef(function({reviewId:n,segments:t,byPara:r,orphans:s,highlighted:i,setHighlighted:o,pending:l,setPending:c,restated:d,readOnly:u},f){const p=h.useRef(null),A=Qn(),v=D(b=>b.snapshot),x=b=>v==null?void 0:v.pages.find(y=>y.id===b),w=b=>{A(`/review/${n}/page/${encodeURIComponent(b)}`)},g=(b,y,C)=>{mc(n,b,y,C)};h.useEffect(()=>{const b=p.current;if(b)for(const[y,C]of Object.entries(d)){if(C.length===0)continue;let S=null;try{S=b.querySelector(`#${CSS.escape(y)}`)}catch{continue}if(!S||S.querySelector("button.back[data-back]"))continue;const N=document.createElement("button");N.className="back",N.type="button",N.setAttribute("data-back",C[0]),N.textContent=C.length>1?`Restated → (${C.length})`:"Restated →",N.title="Show the guide block that restates this paragraph",S.appendChild(N)}},[t,d]),h.useEffect(()=>{const b=p.current;if(!b)return;const y=window.setTimeout(()=>{Ss(b,()=>{Cs(b,"mark.anc[data-thr]");const C=new Set;for(const[S,N]of r){const M=b.querySelector(`[data-top="${CSS.escape(S)}"] .dseg-body`);if(M)for(const R of N)R.anchor.quotedText&&fc(M,R.anchor.quotedText,()=>lx(R.id))>0&&C.add(R.id)}o(S=>cx(S,C)?S:C)})},0);return()=>window.clearTimeout(y)},[r,t,o]);const m=b=>{if(u){F("Viewing an older version · read-only");return}T.updateComment(n,b,{open:!0}).catch(y=>{F(`Couldn't open the comment: ${V(y)}`)})},k=b=>{p.current=b,typeof f=="function"?f(b):f&&(f.current=b)};return a.jsxs("div",{className:"desc",ref:k,onClick:b=>{var O,_,ae,le,fn,qe;const y=(_=(O=b.target).closest)==null?void 0:_.call(O,"mark.anc[data-thr]");if(y){m(y.dataset.thr??"");return}const C=(le=(ae=b.target).closest)==null?void 0:le.call(ae,"a.cx.pg[data-node]");if(C){const z=C.dataset.node??"";z&&w(z);return}const S=(qe=(fn=b.target).closest)==null?void 0:qe.call(fn,"button.back[data-back]");if(!S)return;const N=S.getAttribute("data-back")??"",M=D.getState().snapshot,R=M==null?void 0:M.pages.flatMap(z=>z.cards).find(z=>z.id===N||z.blocks.some(B=>B.id===N));R&&hc(R.id,N)},children:[t.map((b,y)=>{const C=b.id&&r.get(b.id)||[],S=C.filter(R=>R.open),N=C.filter(R=>R.messages.length>0&&!R.open&&!i.has(R.id)),M=l&&l.anchor.where==="description"&&l.anchor.paragraphId===b.id;return a.jsxs("div",{"data-top":b.id??void 0,children:[a.jsx("div",{className:"dseg-body",dangerouslySetInnerHTML:{__html:b.html}}),N.length>0?a.jsxs("button",{className:"lk cm",type:"button","data-threads":N.map(R=>R.id).join("|"),"aria-label":`${N.length} comments`,"data-tip":"Preview the comment thread",onClick:()=>N.forEach(R=>m(R.id)),children:[a.jsx(q,{name:"comment"}),N.length]}):null,S.map(R=>a.jsx("div",{className:"dann",children:a.jsx(Ii,{reviewId:n,thread:R,readOnly:u})},R.id)),b.id?a.jsx(nx,{reviewId:n,paragraphId:b.id,lookupPage:x,onOpenPage:w,onFollowUp:g}):null,M&&l&&!u?a.jsx("div",{className:"dann",children:a.jsx(Di,{reviewId:n,anchor:l.anchor,quote:l.quote,note:l.note,onDiscard:()=>c(null),onCreated:()=>c(null)},"pending")}):null]},b.id??`seg-${y}`)}),s.filter(b=>b.open).length>0?a.jsx("div",{className:"dann",children:s.filter(b=>b.open).map(b=>a.jsx(Ii,{reviewId:n,thread:b,readOnly:u},b.id))}):null]})});function Un(e){if(!Number.isFinite(e))return"—";if(e<1e3)return String(Math.round(e));if(e<1e6){const t=e/1e3;return`${t>=100?Math.round(t):Math.round(t*10)/10}k`}const n=e/1e6;return`${n>=100?Math.round(n):Math.round(n*10)/10}M`}function vc(e){return e===void 0||!Number.isFinite(e)?"—":`${(Math.max(0,Math.min(1,e))*100).toFixed(1)}%`}function fx(e){let n=0,t=0;for(const r of e)r.usage&&(n+=r.usage.inputTokens,t+=r.usage.cachedTokens);return n>0?t/n:void 0}function px(e){let n=0,t=0,r=0;for(const s of e)s.usage&&(n+=s.usage.inputTokens,t+=s.usage.outputTokens,r+=s.usage.cachedTokens);return{input:n,output:t,cached:r}}function hx(e,n=Date.now()){if(e===void 0||!Number.isFinite(e))return"—";const t=Math.max(0,Math.round((e-n)/1e3));return t<60?`retry in ${t}s`:`retry in ${Math.round(t/60)}m`}function ju(e,n){if(n.type!=="job")return e;const t=e.findIndex(s=>s.id===n.job.id);if(t<0)return[...e,n.job];if(e[t]===n.job)return e;const r=[...e];return r[t]=n.job,r}const mx=/<!--\s*layer:([A-Za-z0-9]+)\s+label:(.+?)\s+tokens:(\d+)\s+cached:(yes|no)\s*-->/,Ax=/<!--\s*\/layer:([A-Za-z0-9]+)\s*-->/;function gx(e){const n=[];let t=e,r="";for(;;){const s=mx.exec(t);if(!s)break;const i=t.slice(0,s.index);r===""&&i.trim()!==""?r=i:i.trim()!==""&&n.push({layer:"",label:"text",tokens:0,cached:!1,text:i.trim()});const o=t.slice(s.index+s[0].length),l=Ax.exec(o),c=l?o.slice(0,l.index):o;if(n.push({layer:s[1],label:s[2],tokens:Number(s[3]),cached:s[4]==="yes",text:c.replace(/^\n/,"").replace(/\n+$/,"")}),t=l?o.slice(l.index+l[0].length):"",!l)break}return t.trim()!==""&&n.push({layer:"",label:"text",tokens:0,cached:!1,text:t.trim()}),n.length===0&&e.trim()!==""&&n.push({layer:"",label:"text",tokens:0,cached:!1,text:e.trim()}),r!==""&&n.unshift({layer:"",label:"text",tokens:0,cached:!1,text:r.trim()}),n}function vx(e){const n=(t,r)=>`${t} ${r}`;return`${n(e.changedHunks,"changed")} · ${n(e.newHunks,"new")} · ${n(e.removedHunks,"removed")}`}function il(e){const n=e instanceof Error?e.message:String(e);return/failed to fetch|networkerror|load failed|offline/i.test(n)?"You're offline — showing the last fetched version.":/\b404\b/.test(n)?"The service no longer has this review.":/\b502\b/.test(n)?"Couldn't reach the repo — showing the last fetched version.":"Couldn't check for new commits — showing the last fetched version."}function xx(e){return{fromVersion:e.fromVersion,toVersion:e.toVersion,changedHunks:e.changedHunks,newHunks:e.newHunks,removedHunks:e.removedHunks,rangeDiff:e.rangeDiff}}function Nu(e,n){return{fromVersion:e.oldVersion,toVersion:Math.max(e.newVersion,n),changedHunks:e.changedHunks,newHunks:e.newHunks,removedHunks:e.removedHunks,rangeDiff:e.rangeDiff}}function kx({reviewId:e,counts:n,onUpdated:t}){const[r,s]=h.useState({name:"idle"}),i=h.useRef(void 0);h.useEffect(()=>()=>window.clearTimeout(i.current),[]),h.useEffect(()=>{s({name:"idle"})},[n.toVersion,n.rangeDiff]);const o=async()=>{s({name:"updating",jobId:"",job:null});let d;try{d=(await T.update(e)).jobId}catch(f){s({name:"failed",message:wx(f)});return}s({name:"updating",jobId:d,job:null});const u=async()=>{let f;try{f=(await T.job(d)).job}catch{i.current=window.setTimeout(()=>void u(),2e3);return}if(f.state==="queued"||f.state==="running"||f.state==="backing-off"){s({name:"updating",jobId:d,job:f}),i.current=window.setTimeout(()=>void u(),1e3);return}if(f.state==="done"){t(),s({name:"idle"});return}s({name:"failed",message:f.error??`update ${f.state}`})};u()},l=r.name==="updating"?r:null,c=(l==null?void 0:l.job)??null;return a.jsxs("div",{className:"dbar","data-testid":"stale-banner",role:"status",children:[a.jsxs("span",{className:"hint",children:["New commits on this branch · v",n.fromVersion," → v",n.toVersion," (",vx(n)," hunks)"]}),a.jsx("span",{className:"sp"}),n.rangeDiff.trim()!==""?a.jsxs("details",{children:[a.jsx("summary",{className:"hint",style:{cursor:"pointer"},children:"range-diff"}),a.jsx("pre",{className:"code","data-testid":"range-diff",children:n.rangeDiff})]}):null,r.name==="failed"?a.jsx("span",{className:"hint",children:r.message}):null,l?a.jsxs("span",{className:"hint","data-testid":"update-progress","aria-live":"polite",children:["Updating…",c?` ${c.state}${c.progress?` · ${c.progress}`:""}`:"",c!=null&&c.usage?` · ${Un(c.usage.inputTokens)} in (${vc(c.cacheHitRate)} cached)`:""]}):a.jsx("button",{className:"x",type:"button",onClick:()=>void o(),children:"Update"})]})}function wx(e){const n=e instanceof Error?e.message:String(e);return/501/.test(n)?"Update isn't available in this build yet.":/409/.test(n)?"Already up to date":`Couldn't start the update: ${V(e)}`}function xc(e,n,t,r){return n.has(xn(t,r))}function Th(e,n,t,r){return xc(e,n,t,r)?"Show comment":`Comment on line ${r}`}function Rh({cols:e,html:n}){return a.jsx("tr",{className:"pr",children:a.jsx("td",{colSpan:e,children:a.jsx("div",{className:"pin",style:{padding:"6px 10px 6px 34px",background:"var(--bg)"},children:n})})})}function Ph(e,n){return n!==void 0&&e!==null&&n>=e.start&&n<=e.end}function yx({fileKey:e,hunk:n,slots:t,commentedLines:r,highlight:s,onLineClick:i}){const o=n.lines;return a.jsx(a.Fragment,{children:o.map((l,c)=>{const d=l.newLine,u=Ph(s,d),f=d!==void 0&&xc(t,r,e,d);return a.jsxs(h.Fragment,{children:[a.jsxs("tr",{className:`${l.kind}${u?" hl":""}`,id:d!==void 0?`L-${e}-${d}`:void 0,children:[a.jsx("td",{className:"n",children:l.oldLine??""}),a.jsxs("td",{className:`n${d!==void 0?" new":""}${f?" hc":""}`,"data-line":d!==void 0?`${e}:${d}`:void 0,"data-tip":d!==void 0?Th(t,r,e,d):void 0,onClick:d!==void 0&&i?()=>i(e,d):void 0,children:[f?a.jsx(q,{name:"comment"}):null,d??""]}),a.jsx("td",{className:"c",children:a.jsx("span",{className:/^\s*#/.test(l.text)?"cm":void 0,children:(l.kind==="add"?"+":l.kind==="del"?"-":" ")+l.text})})]}),d!==void 0&&t[xn(e,d)]!=null?a.jsx(Rh,{cols:3,html:t[xn(e,d)]}):null]},`${l.kind}-${l.oldLine??""}-${d??""}-${c}`)})})}function bx({fileKey:e,hunk:n,slots:t,commentedLines:r,highlight:s,onLineClick:i}){const o=S2(n.lines),l=(c,d)=>{if(!c)return a.jsxs(a.Fragment,{children:[a.jsx("td",{className:"n empty"}),a.jsx("td",{className:"c empty"})]});const u=d==="o"?c.oldLine:c.newLine,f=c.kind==="ctx"?"":c.kind,p=d==="n"&&u!==void 0,A=p&&xc(t,r,e,u);return a.jsxs(a.Fragment,{children:[a.jsxs("td",{className:`n${p?" new":""}${A?" hc":""} ${f}`,"data-line":p?`${e}:${u}`:void 0,"data-tip":p?Th(t,r,e,u):void 0,onClick:p&&i?()=>i(e,u):void 0,children:[A?a.jsx(q,{name:"comment"}):null,u??""]}),a.jsx("td",{className:`c ${f}`,children:a.jsx("span",{className:/^\s*#/.test(c.text)?"cm":void 0,children:c.text})})]})};return a.jsx(a.Fragment,{children:o.map((c,d)=>{var p,A;const u=c.kind==="ctx"?c.line.newLine:(p=c.right)==null?void 0:p.newLine,f=Ph(s,u);return a.jsxs(h.Fragment,{children:[a.jsx("tr",{className:f?"hl":void 0,id:u!==void 0?`L-${e}-${u}`:void 0,children:c.kind==="ctx"?a.jsxs(a.Fragment,{children:[l(c.line,"o"),l(c.line,"n")]}):a.jsxs(a.Fragment,{children:[l(c.left,"o"),l(c.right,"n")]})}),u!==void 0&&t[xn(e,u)]!=null?a.jsx(Rh,{cols:4,html:t[xn(e,u)]}):null]},c.kind==="ctx"?`ctx-${u}-${d}`:`pair-${((A=c.left)==null?void 0:A.oldLine)??""}-${u??""}-${d}`)})})}function Cx({reviewed:e,summary:n,note:t,noteStale:r,noteDraft:s,hash:i,actions:o}){return a.jsxs("div",{className:`fcard${e?" rev":""}`,children:[n?a.jsxs("div",{className:"fsum",children:[a.jsx("span",{className:"av ai",children:"AI"}),a.jsx("p",{children:n}),a.jsx("button",{className:"ib",type:"button","data-tip":"Delete summary","aria-label":"Delete summary",onClick:()=>o.deleteSummary(i),children:a.jsx(q,{name:"trash"})})]}):null,t&&s===void 0?a.jsxs("div",{className:"fsum",children:[a.jsx("span",{className:"av you",children:"Me"}),a.jsxs("div",{children:[a.jsx("p",{style:{margin:0},children:t}),r?a.jsx("span",{className:"hint",children:"code changed since this note"}):null]}),a.jsx("button",{className:"ib",type:"button","data-tip":"Delete note","aria-label":"Delete note",onClick:()=>o.deleteNote(i),children:a.jsx(q,{name:"trash"})})]}):null,s!==void 0?a.jsxs("div",{className:"composer",children:[a.jsx("textarea",{id:`hn-${i}`,rows:2,placeholder:"Your note on this hunk…",value:s,onChange:l=>o.changeNote(i,l.target.value)}),a.jsxs("div",{className:"row",children:[a.jsx("button",{className:"btn ghost",type:"button",onClick:()=>o.discardNote(i),children:"Discard"}),a.jsx("button",{className:"btn",type:"button",onClick:()=>o.saveNote(i),children:"Save"})]})]}):null]})}function Sx({file:e,indices:n,cols:t,briefs:r,summaries:s,onUnhide:i}){const o=[...new Set(n.map(u=>e.hunks[u].hiddenReason).filter(u=>u!==void 0))].join(", "),l=n.reduce((u,f)=>u+e.hunks[f].added,0),c=n.reduce((u,f)=>u+e.hunks[f].removed,0),d=[...new Set(n.map(u=>{var f;return(r==null?void 0:r[`${e.fileKey}:${u}`])??((f=s.get(e.hunks[u].contentHash))==null?void 0:f.summary)??L2(e.hunks[u].hiddenReason)}))].filter(Boolean).join(" ");return a.jsx("tr",{className:"pr",children:a.jsx("td",{colSpan:t,children:a.jsxs("button",{className:"pin hid",type:"button","data-tip":"Show these hunks","aria-label":`${uu(e,n)} hidden. Show these hunks`,onClick:()=>i(n.map(u=>e.hunks[u].contentHash)),children:[a.jsx(q,{name:"right"}),a.jsxs("span",{className:"hidl",children:[uu(e,n)," hidden · ",o," · +",l," −",c]}),a.jsx("span",{className:"hidb",children:d})]})})})}function Ex(e){var m,k;const{file:n,index:t,cols:r}=e,s=n.hunks[t],i=e.states.get(s.contentHash),o=(i==null?void 0:i.folded)??!1,l=(i==null?void 0:i.reviewed)??!1,c=i==null?void 0:i.summary,d=i==null?void 0:i.note,u=(i==null?void 0:i.stale)===!0,f=(i==null?void 0:i.noteStale)===!0,p=(i==null?void 0:i.needsSummary)===!0&&!c,A=e.editingNote[s.contentHash],v=!!e.busy[s.contentHash],x=`${n.fileKey}:${t}`,w=(k=(m=s.context)==null?void 0:m.match(/(?:def|class)\s+(\w+)/))==null?void 0:k[1],g={fileKey:n.fileKey,hunk:s,slots:e.slots,commentedLines:e.commentedLines,highlight:e.highlight,onLineClick:e.onLineClick};return a.jsxs(a.Fragment,{children:[a.jsx("tr",{className:"pr",children:a.jsx("td",{colSpan:r,children:a.jsxs("div",{className:`pin hh${l?" rev":""}`,"data-hunk":x,children:[a.jsx("button",{className:"ib",type:"button","data-tip":o?"Show code":"Fold code","aria-label":o?"Show code":"Fold code",onClick:()=>e.actions.toggleFold(s.contentHash,o),children:a.jsx(q,{name:o?"right":"down"})}),a.jsxs("span",{className:"hl2","data-tip":s.header,children:[a.jsxs("b",{children:["Hunk ",t+1," of ",n.hunks.length]})," ","· lines ",s.newStart,"–",s.newEnd,w?` · in ${w}`:""," ·"," ",a.jsxs("span",{className:"st",children:[a.jsxs("span",{className:"a",children:["+",s.added]})," ",a.jsxs("span",{className:"d",children:["−",s.removed]})]}),u?a.jsx("span",{className:"prtag",children:"changed since reviewed"}):null]}),p&&!v?a.jsx("span",{className:"hint","data-tip":"The update pass regenerates this summary",children:"summary pending regeneration"}):null,v?a.jsx("span",{className:"hint","aria-label":"Summarizing",children:a.jsxs("span",{className:"dots",children:[a.jsx("i",{}),a.jsx("i",{}),a.jsx("i",{})]})}):c?null:a.jsx("button",{className:"ib",type:"button","data-tip":"Summarize with agent","aria-label":"Summarize with agent",onClick:()=>e.actions.summarize(s.contentHash),children:a.jsx(q,{name:"spark"})}),a.jsx("button",{className:"ib",type:"button","data-tip":d?"Edit note":"Add note","aria-label":d?"Edit note":"Add note",onClick:()=>e.actions.beginNote(s.contentHash,d),children:a.jsx(q,{name:"note"})}),a.jsx("button",{className:"ib",type:"button","data-tip":l?"Mark not reviewed":"Mark reviewed","aria-label":l?"Mark not reviewed":"Mark reviewed","aria-pressed":l,onClick:()=>e.actions.toggleReviewed(s.contentHash,l),children:a.jsx(q,{name:"check"})})]})})}),c??d??A!==void 0?a.jsx("tr",{className:"pr",children:a.jsx("td",{colSpan:r,children:a.jsx("div",{className:"pin fwrap",children:a.jsx(Cx,{reviewed:l,summary:c,note:d,noteStale:f,noteDraft:A,hash:s.contentHash,actions:e.actions})})})}):null,o?a.jsx("tr",{className:"pr",children:a.jsx("td",{colSpan:r,children:a.jsxs("button",{className:"pin folded",type:"button","aria-label":`${s.added+s.removed} changed lines folded. Show`,onClick:()=>e.actions.toggleFold(s.contentHash,o),children:[s.added+s.removed," changed lines folded · show"]})})}):e.view==="unified"?a.jsx(yx,{...g}):a.jsx(bx,{...g})]})}function jx(e){const{file:n,view:t}=e,[r,s]=h.useState(e.eager),i=h.useRef(null),o=E2(n),l=n.path.split("/").pop(),c=n.path.slice(0,Math.max(0,n.path.length-l.length)),d=e.reviewed===n.hunks.length,u=t==="split"?4:3;return h.useEffect(()=>{if(e.eager){s(!0);return}if(typeof IntersectionObserver>"u"){s(!0);return}const f=i.current;if(!f){s(!0);return}const p=new IntersectionObserver(A=>{A.some(v=>v.isIntersecting)&&(s(!0),p.disconnect())},{root:document.getElementById("right")??void 0});return p.observe(f),()=>p.disconnect()},[e.eager]),a.jsxs("div",{className:`dfile${e.fileHighlighted?" hl":""}`,id:`F-${n.fileKey}`,children:[a.jsxs("div",{className:"dfile-h",children:[a.jsx("button",{className:"ib",type:"button","data-tip":e.folded?"Expand file":"Collapse file","aria-label":e.folded?"Expand file":"Collapse file",onClick:()=>e.onToggleFileFold(n.fileKey),children:a.jsx(q,{name:e.folded?"right":"down"})}),a.jsxs("span",{className:"path",title:n.isRename&&n.oldPath?`${n.oldPath} → ${n.path}`:n.path,children:[a.jsx("span",{className:"dir",children:c}),a.jsx("b",{children:l})]}),n.isRename&&n.oldPath?a.jsxs("span",{className:"hint",children:["← ",n.oldPath.split("/").pop()]}):null,n.isBinary?a.jsx("span",{className:"gtag",children:"binary"}):null,n.category==="generated"?a.jsx("span",{className:"gtag",children:"generated"}):null,a.jsxs("span",{className:"st",children:[a.jsxs("span",{className:"a",children:["+",o.added]})," ",a.jsxs("span",{className:"d",children:["−",o.removed]})]}),a.jsxs("span",{className:"revc",children:[e.reviewed,"/",n.hunks.length]}),a.jsx("button",{className:"ib",type:"button","data-tip":d?"Mark file not reviewed":"Mark file reviewed","aria-label":d?"Mark file not reviewed":"Mark file reviewed","aria-pressed":d,onClick:()=>e.onMarkFileReviewed(n,d),children:a.jsx(q,{name:"check"})})]}),e.folded?null:a.jsx("div",{className:"dwrap",ref:i,children:n.isBinary?a.jsx("p",{className:"hint",style:{padding:"6px 10px"},children:"Binary file · changes not shown."}):r?a.jsxs("table",{className:`diff ${t}`,children:[t==="split"?a.jsxs("colgroup",{children:[a.jsx("col",{className:"cn"}),a.jsx("col",{}),a.jsx("col",{className:"cn"}),a.jsx("col",{})]}):null,a.jsx("tbody",{children:C2(n.hunks,e.isHidden).map(f=>f.type==="hidden"?a.jsx(Sx,{file:n,indices:f.indices,cols:u,briefs:e.briefs,summaries:e.states,onUnhide:e.onUnhide},`hid-${f.indices.join("-")}`):a.jsx(Ex,{index:f.index,cols:u,...e},`hunk-${n.fileKey}-${f.index}`))})]}):a.jsx("div",{style:{minHeight:28},"aria-hidden":"true"})})]})}const ol="unvibe:widen-pane",Mh="unvibe.diff.prefs.v1",Bh=[{k:"source",l:"Source .py"},{k:"tests",l:"Tests"},{k:"docs",l:"Docs"},{k:"config",l:"Config"},{k:"generated",l:"Generated"}],qo={view:"unified",hideUninteresting:!0,hideReviewed:!1,cats:Bh.map(e=>e.k),filesOpen:!1};function Nx(){try{const e=localStorage.getItem(Mh);if(!e)return qo;const n=JSON.parse(e);return{view:n.view==="split"?"split":"unified",hideUninteresting:n.hideUninteresting??!0,hideReviewed:n.hideReviewed??!1,cats:Array.isArray(n.cats)&&n.cats.length>0?n.cats:[...qo.cats],filesOpen:n.filesOpen??!1}}catch{return qo}}function Lx({reviewId:e,lineSlots:n,commentedLines:t,onLineClick:r}){const s=D(E=>E.snapshot),i=D(E=>E.setSnapshot),[o,l]=h.useState(Nx),[c,d]=h.useState(""),[u,f]=h.useState({}),[p,A]=h.useState({}),[v,x]=h.useState({}),[w,g]=h.useState({}),[m,k]=h.useState({}),[b,y]=h.useState(null),[C,S]=h.useState(null),[N,M]=h.useState(null),[R,O]=h.useState(!1),[_,ae]=h.useState(new Set),le=ro(),[fn,qe]=h.useState(null),z=h.useRef(void 0),B=Qv(),U=h.useMemo(()=>({...B,...n}),[B,n]);h.useEffect(()=>{try{localStorage.setItem(Mh,JSON.stringify(o))}catch{}},[o]),h.useEffect(()=>{if(s)return;let E=!1;return T.review(e,le).then(P=>{E||i(P)}).catch(()=>{}),()=>{E=!0}},[e,le,s,i]);const W=s==null?void 0:s.review.repoId;h.useEffect(()=>{if(le!==void 0||!W||W==="demo")return;let E=!1;return T.refresh(e).then(P=>{if(!E&&P.newVersion&&P.comparison){const I=D.getState().snapshot,Z=(I==null?void 0:I.review.currentVersion)??P.comparison.newVersion;M(Nu(P.comparison,Z))}}).catch(P=>{E||F(il(P))}),()=>{E=!0}},[e,le,W]);const ne=h.useCallback(async()=>{O(!0);try{const E=await T.refresh(e);if(E.newVersion&&E.comparison){const P=D.getState().snapshot,I=(P==null?void 0:P.review.currentVersion)??E.comparison.newVersion;M(Nu(E.comparison,I)),i(await T.review(e))}else M(null),F("Already up to date")}catch(E){F(il(E))}finally{O(!1)}},[e,i]),fe=h.useCallback(async()=>{M(null);try{i(await T.review(e)),F("Review updated")}catch{F("Updated, but couldn't reload the review")}},[e,i]);h.useEffect(()=>{},[]);const Me=h.useMemo(()=>new Map(((s==null?void 0:s.hunkStates)??[]).map(E=>[E.contentHash,E])),[s]),Ee=h.useCallback(E=>E.hunks.filter(P=>{var I;return(I=Me.get(P.contentHash))==null?void 0:I.reviewed}).length,[Me]),pn=h.useMemo(()=>s?N2(s.files,s.pages,s.annotations):new Set,[s]),nn=h.useCallback(E=>fu(E,{hideUninteresting:o.hideUninteresting,unhidden:!!p[E.contentHash],cited:pn.has(E.contentHash)}),[o.hideUninteresting,p,pn]),ze=h.useMemo(()=>new Set(o.cats),[o.cats]),yt=h.useMemo(()=>s?du(s.files,{query:c,cats:ze,hideReviewed:o.hideReviewed,reviewedCount:Ee}):[],[s,c,ze,o.hideReviewed,Ee]),Zn=h.useMemo(()=>{const E=(s==null?void 0:s.files)??[],P=E.reduce((Z,ie)=>Z+ie.hunks.length,0);return{reviewed:E.reduce((Z,ie)=>Z+ie.hunks.filter(En=>{var Er;return(Er=Me.get(En.contentHash))==null?void 0:Er.reviewed}).length,0),total:P}},[s,Me]);h.useEffect(()=>{k(E=>{var Z;let P=!1;const I={...E};for(const ie of Object.keys(I))(Z=Me.get(ie))!=null&&Z.summary&&(delete I[ie],P=!0);return P?I:E})},[Me]);const Sr=h.useCallback((E,P)=>{window.clearTimeout(z.current),y(E),S(P),z.current=window.setTimeout(()=>{y(null),S(null)},2600)},[]),j=h.useCallback(E=>{var Er;const P=D.getState().snapshot;if(!P)return;const I=P.files.find($=>$.fileKey===E.fileKey);if(!I)return;const Z=new Map(P.hunkStates.map($=>[$.contentHash,$])),ie=I.hunks.every($=>{var jr;return(jr=Z.get($.contentHash))==null?void 0:jr.reviewed});if(l($=>({...$,cats:$.cats.includes(I.category)?$.cats:[...$.cats,I.category],hideReviewed:$.hideReviewed&&ie?!1:$.hideReviewed})),d($=>I.path.toLowerCase().includes($.toLowerCase())?$:""),f($=>({...$,[I.fileKey]:!1})),ae($=>new Set($).add(I.fileKey)),E.start===void 0){Sr(null,I.fileKey);return}const En=E.end??E.start;A($=>{const jr={...$};for(const yc of I.hunks)el(yc,E.start,En)&&(jr[yc.contentHash]=!0);return jr});for(const $ of I.hunks)el($,E.start,En)&&((Er=Z.get($.contentHash))!=null&&Er.folded)&&T.updateHunk(e,$.contentHash,{folded:!1}).catch(()=>{});Sr({fileKey:I.fileKey,start:E.start,end:En,nonce:Date.now()},null)},[e,Sr]);h.useEffect(()=>{if(!s)return;const E=P2();if(E){const P=vh(E);P&&j(P)}},[s,j]),h.useEffect(()=>T2((E,P)=>j(P)),[j]),h.useEffect(()=>{},[]),h.useEffect(()=>{var I;if(!b&&!C)return;const E=(b==null?void 0:b.fileKey)??C;if(!E)return;let P=null;if(b)for(let Z=b.start;Z<=b.end&&(P=document.getElementById(`L-${E}-${Z}`),!P);Z++);P??(P=document.getElementById(`F-${E}`)),(I=P==null?void 0:P.scrollIntoView)==null||I.call(P,{block:"center"})},[b,C]),h.useEffect(()=>()=>window.clearTimeout(z.current),[]);const K=le!==void 0&&s!==null&&le!==s.review.currentVersion,se=h.useCallback(async(E,P)=>{if(K&&(P.reviewed!==void 0||P.note!==void 0||P.summary!==void 0)){F("Viewing an older version — back to current to change state");return}try{await T.updateHunk(e,E,P)}catch{F("Couldn't save hunk state")}},[e,K]),Sn=h.useMemo(()=>({toggleFold:(E,P)=>void se(E,{folded:!P}),summarize:E=>{if(K){F("Viewing an older version — back to current to change state");return}k(P=>({...P,[E]:!0})),T.summarizeHunk(e,E).catch(()=>{F("Couldn't summarize hunk"),k(P=>{const I={...P};return delete I[E],I})})},deleteSummary:E=>void se(E,{summary:null}),beginNote:(E,P)=>{g(I=>({...I,[E]:P??""})),setTimeout(()=>{var I;return(I=document.getElementById(`hn-${E}`))==null?void 0:I.focus()},0)},changeNote:(E,P)=>g(I=>({...I,[E]:P})),saveNote:E=>{const P=(w[E]??"").trim();g(I=>{const Z={...I};return delete Z[E],Z}),se(E,{note:P===""?null:P})},discardNote:E=>g(P=>{const I={...P};return delete I[E],I}),deleteNote:E=>void se(E,{note:null}),toggleReviewed:(E,P)=>void se(E,{reviewed:!P,folded:!P})}),[se,e,w]),Yn=h.useCallback(E=>{E==="split"&&window.dispatchEvent(new CustomEvent(ol)),l(P=>({...P,view:E}))},[]),io=h.useCallback(async()=>{var Z;if(K){F("Viewing an older version — back to current to change state");return}const E=D.getState().snapshot;if(!E)return;const P=new Map(E.hunkStates.map(ie=>[ie.contentHash,ie])),I=[];for(const ie of du(E.files,{query:c,cats:new Set(o.cats),hideReviewed:o.hideReviewed,reviewedCount:Ee}))ie.hunks.forEach(En=>{fu(En,{hideUninteresting:o.hideUninteresting,unhidden:!!p[En.contentHash],cited:pn.has(En.contentHash)})||I.push({file:ie,hunk:En})});await Promise.all(I.map(({hunk:ie})=>T.updateHunk(e,ie.contentHash,{folded:!0}).catch(()=>{})));for(const{hunk:ie}of I)(Z=P.get(ie.contentHash))!=null&&Z.summary||Sn.summarize(ie.contentHash);F(`Summarized and folded ${I.length} hunks.`)},[e,K,c,o,Ee,p,pn,Sn]),Oh=h.useCallback(async()=>{if(K){F("Viewing an older version — back to current to change state");return}const E=D.getState().snapshot;E&&(f({}),await Promise.all(E.files.flatMap(P=>P.hunks.map(I=>T.updateHunk(e,I.contentHash,{folded:!1}).catch(()=>{})))))},[e,K]),Hh=h.useCallback((E,P)=>{if(K){F("Viewing an older version — back to current to change state");return}Promise.all(E.hunks.map(I=>T.updateHunk(e,I.contentHash,{reviewed:!P,folded:!P}).catch(()=>{}))).catch(()=>F("Couldn't save hunk state"))},[e,K]);if(!s)return a.jsx("div",{children:a.jsx("div",{className:"dtool",children:a.jsx("span",{className:"hint",children:"Loading diff…"})})});const kc=o.filesOpen?b2(yt):[],zh=E=>s.files.filter(P=>P.category===E).length,wc=K?null:N??(s.versionStatus?xx(s.versionStatus):null);return a.jsxs("div",{children:[a.jsxs("div",{className:"dtool",children:[a.jsxs("button",{className:"tbtn",type:"button","aria-expanded":o.filesOpen,"data-tip":o.filesOpen?"Hide the file list":"Show the file list","aria-label":o.filesOpen?"Hide files panel":"Show files panel",onClick:()=>l(E=>({...E,filesOpen:!E.filesOpen})),children:[a.jsx(q,{name:o.filesOpen?"down":"right"}),"Files ",a.jsxs("span",{className:"hint",children:[yt.length,"/",s.files.length]})]}),a.jsxs("span",{className:"seg",role:"group","aria-label":"Diff view",children:[a.jsx("button",{type:"button","aria-pressed":o.view==="unified",onClick:()=>Yn("unified"),children:"Unified"}),a.jsx("button",{type:"button","aria-pressed":o.view==="split",onClick:()=>Yn("split"),children:"Split"})]}),a.jsxs("button",{className:"x",type:"button","aria-pressed":o.hideUninteresting,"data-tip":"Collapse generated, import-only, docs and config hunks to one line","aria-label":"Hide uninteresting",onClick:()=>l(E=>(E.hideUninteresting||A({}),{...E,hideUninteresting:!E.hideUninteresting})),children:[o.hideUninteresting?"✓ ":"","Hide uninteresting"]}),a.jsxs("button",{className:"x",type:"button","data-tip":"Summarize every hunk with the agent, then fold the code","aria-label":"Fold all",onClick:()=>void io(),children:[a.jsx(q,{name:"spark"}),"Fold all"]}),a.jsx("button",{className:"x",type:"button","data-tip":"Show code for every folded hunk; summaries stay","aria-label":"Unfold all",onClick:()=>void Oh(),children:"Unfold all"}),a.jsx("button",{className:"x",type:"button","data-tip":"Fetch and compare with the branch (no agent time)","aria-label":"Refresh",disabled:R||K,onClick:()=>void ne(),children:R?"Refreshing…":"Refresh"})]}),K?a.jsx("div",{className:"dbar",role:"status",children:a.jsxs("span",{className:"hint",children:["Viewing v",le," · read-only"]})}):null,wc?a.jsx(kx,{reviewId:e,counts:wc,onUpdated:()=>void fe()}):null,o.filesOpen?a.jsxs("div",{className:"files",children:[a.jsxs("div",{className:"frow",children:[a.jsx("input",{type:"search",id:"fq",placeholder:"Filter files by name","aria-label":"Filter files by name",value:c,onChange:E=>d(E.target.value)}),a.jsx("button",{className:"chip",type:"button","aria-pressed":o.hideReviewed,onClick:()=>l(E=>({...E,hideReviewed:!E.hideReviewed})),children:"Hide reviewed"})]}),a.jsx("div",{className:"frow",role:"group","aria-label":"File types",children:Bh.map(E=>a.jsxs("button",{className:"chip",type:"button","aria-pressed":ze.has(E.k),onClick:()=>l(P=>({...P,cats:P.cats.includes(E.k)?P.cats.filter(I=>I!==E.k):[...P.cats,E.k]})),children:[E.l,a.jsx("span",{children:zh(E.k)})]},E.k))}),a.jsxs("div",{className:"prog",children:[a.jsxs("span",{children:[Zn.reviewed,"/",Zn.total," hunks reviewed"]}),a.jsx("span",{className:"bar",children:a.jsx("i",{style:{width:`${Zn.total===0?0:Math.round(100*Zn.reviewed/Zn.total)}%`}})})]}),a.jsx("div",{className:"flist",children:kc.length>0?kc.map(E=>E.type==="dir"?a.jsxs("button",{className:"fr dir",type:"button",style:{paddingLeft:10+E.depth*14},"aria-expanded":v[E.path]??!0,onClick:()=>x(P=>({...P,[E.path]:!(P[E.path]??!0)})),children:[a.jsx(q,{name:v[E.path]??!0?"down":"right"}),a.jsx("span",{className:"nm",title:E.path,children:E.label})]},`dir-${E.path}`):a.jsx(Tx,{file:E.file,depth:E.depth,reviewed:Ee(E.file),onJump:P=>{f(I=>({...I,[P]:!1})),ae(I=>new Set(I).add(P)),setTimeout(()=>{const I=document.getElementById(`F-${P}`),Z=document.querySelector("#right .rstick");if(!I)return;const ie=document.getElementById("right");ie&&Z?ie.scrollTop+=I.getBoundingClientRect().top-Z.getBoundingClientRect().bottom:I.scrollIntoView({block:"start"})},0)}},`file-${E.file.fileKey}`)):a.jsx("p",{className:"hint",style:{padding:"4px 10px",margin:0},children:"No files match."})})]}):null,yt.length>0?yt.map((E,P)=>a.jsx(jx,{file:E,view:o.view,reviewed:Ee(E),folded:!!u[E.fileKey],eager:P<3||_.has(E.fileKey),busy:m,editingNote:w,slots:U,commentedLines:t??new Set,highlight:(b==null?void 0:b.fileKey)===E.fileKey?{start:b.start,end:b.end}:null,fileHighlighted:C===E.fileKey,briefs:fn,states:Me,isHidden:nn,actions:Sn,onLineClick:r,onToggleFileFold:I=>f(Z=>({...Z,[I]:!Z[I]})),onMarkFileReviewed:Hh,onUnhide:I=>A(Z=>({...Z,...Object.fromEntries(I.map(ie=>[ie,!0]))}))},E.fileKey)):a.jsx("p",{className:"hint",style:{padding:16},children:"No files match the current filters."})]})}function Tx({file:e,depth:n,reviewed:t,onJump:r}){const s=e.hunks.length,i=e.hunks.reduce((l,c)=>l+c.added,0),o=e.hunks.reduce((l,c)=>l+c.removed,0);return a.jsxs("button",{className:"fr",type:"button",style:{paddingLeft:10+n*14+20},title:e.path,onClick:()=>r(e.fileKey),children:[a.jsx("span",{className:"nm",children:e.path.split("/").pop()}),e.category==="generated"?a.jsx("span",{className:"gtag",children:"gen"}):null,a.jsxs("span",{className:"st",children:[a.jsxs("span",{className:"a",children:["+",i]})," ",a.jsxs("span",{className:"d",children:["−",o]})]}),a.jsx("span",{className:`rv${t===s?" done":""}`,children:t===s?"✓":`${t}/${s}`})]})}function Rx({reviewId:e,tab:n,onTab:t}){const r=Qn(),s=D(p=>{var A;return(A=p.snapshot)==null?void 0:A.pages}),i=p=>s==null?void 0:s.find(A=>A.id===p),o=p=>{r(`/review/${e}/page/${encodeURIComponent(p)}`)},l=(p,A,v)=>{mc(e,p,A,v)},c=Zv(e),d=Xv(e,i,o,l),u=h.useMemo(()=>({...d.lineSlots,...c.lineSlots}),[d.lineSlots,c.lineSlots]),f=c.commentedLines;return h.useEffect(()=>{const p=A=>{var x;const v=(x=A.detail)==null?void 0:x.ref;t(typeof v=="string"&&v.startsWith("desc:")?"desc":"diff")};return window.addEventListener(Ht,p),()=>window.removeEventListener(Ht,p)},[t]),a.jsxs(a.Fragment,{children:[a.jsx("div",{className:"rstick",children:a.jsxs("div",{className:"tabs",role:"tablist",children:[a.jsx("button",{className:"tab",role:"tab",type:"button","aria-selected":n==="desc",onClick:()=>t("desc"),children:"PR description"}),a.jsx("button",{className:"tab",role:"tab",type:"button","aria-selected":n==="diff",onClick:()=>t("diff"),children:"Diff"}),a.jsx("span",{className:"sp"}),a.jsx(Gv,{reviewId:e})]})}),n==="desc"?a.jsx(dx,{reviewId:e}):a.jsx(Lx,{reviewId:e,lineSlots:u,commentedLines:f,onLineClick:c.onLineClick})]})}const Px="Viewing an older version · read-only · back to current to submit";function Mx(e){const n=e.location;if(n.kind==="inline"){const t=n.path.split("/").pop()??n.path,r=n.startLine!==void 0&&(n.startLine!==n.line||n.startSide!==n.side)?`${n.startLine}–${n.line}`:`${n.line}`;return`${t}:${r}`}return n.reason??"General PR comment"}function Bx({reviewId:e}){const n=D(A=>A.snapshot),t=Cr(),r=Lh(),[s,i]=h.useState(!1),[o,l]=h.useState({status:"loading"}),c=t?0:Sh(n),d=r?`Submit as ${r}`:"Submit review";h.useEffect(()=>{if(!s)return;if(t){l({status:"ready",preview:{comments:[],alreadyPosted:[],reviewBody:"",commitId:"",disabledReason:Px}});return}l({status:"loading"});let A=!1;return T.submit(e,{dryRun:!0}).then(v=>{A||(v.preview?l({status:"ready",preview:v.preview}):v.reason?l({status:"ready",preview:{comments:[],alreadyPosted:[],reviewBody:"",commitId:"",disabledReason:v.reason}}):l({status:"error",error:"Couldn't load the submit preview."}))}).catch(v=>{A||l({status:"error",error:V(v)})}),()=>{A=!0}},[s,e,t]),h.useEffect(()=>{if(!s)return;const A=v=>{v.key==="Escape"&&i(!1)};return document.addEventListener("keydown",A),()=>document.removeEventListener("keydown",A)},[s]);const u=()=>{l({status:"loading"}),T.submit(e,{dryRun:!0}).then(A=>{A.preview?l({status:"ready",preview:A.preview}):l({status:"error",error:A.reason??"Couldn't load the submit preview."})}).catch(A=>{l({status:"error",error:V(A)})})},f=()=>{T.refresh(e).then(()=>T.review(e)).then(A=>{D.getState().setSnapshot(A),u(),F("Review refreshed — check the preview before submitting.")}).catch(A=>{F(il(A))})},p=A=>{l({status:"submitting",preview:A}),T.submit(e,{expectedCount:A.comments.length}).then(v=>{if(v.preview){l({status:"ready",preview:v.preview});return}if(v.partial){l({status:"partial",commentCount:v.commentCount,reviewUrl:v.reviewUrl,error:v.reason??"The review posted but the description update failed."});return}if(v.posted){l({status:"done",commentCount:v.commentCount,descriptionUpdated:v.descriptionUpdated,...v.reviewUrl?{reviewUrl:v.reviewUrl}:{}}),T.review(e).then(x=>D.getState().setSnapshot(x)).catch(()=>{});return}l({status:"error",error:v.reason??"Nothing was posted."})}).catch(v=>{const x=v instanceof Error?v.message:String(v);/409/.test(x)&&/head moved|refresh/i.test(x)?l({status:"conflict",error:x}):l({status:"error",error:x})})};return a.jsxs("span",{id:"submitSlot",children:[a.jsxs("button",{className:"tbtn",type:"button","data-submit":"","aria-expanded":s,onClick:()=>i(A=>!A),children:["Submit review",c>0?a.jsx("span",{className:"count",children:c}):null]}),s?a.jsxs("div",{className:"submit",role:"dialog","aria-label":"Submit review",children:[o.status==="loading"?a.jsx("span",{className:"hint",children:"Loading the preview…"}):null,o.status==="submitting"?a.jsx("span",{className:"hint",children:"Submitting…"}):null,o.status==="error"?a.jsxs(a.Fragment,{children:[a.jsx("b",{children:"Couldn't submit"}),a.jsx("span",{className:"hint",children:o.error}),a.jsxs("div",{className:"frow",style:{justifyContent:"flex-end"},children:[a.jsx("button",{className:"btn ghost",type:"button","data-submitclose":"",onClick:()=>i(!1),children:"Cancel"}),a.jsx("button",{className:"btn",type:"button",onClick:u,children:"Retry"})]})]}):null,o.status==="conflict"?a.jsxs(a.Fragment,{children:[a.jsx("b",{children:"The branch moved"}),a.jsx("span",{className:"hint",children:o.error}),a.jsxs("div",{className:"frow",style:{justifyContent:"flex-end"},children:[a.jsx("button",{className:"btn ghost",type:"button","data-submitclose":"",onClick:()=>i(!1),children:"Cancel"}),a.jsx("button",{className:"btn",type:"button",onClick:f,children:"Refresh the review"})]})]}):null,o.status==="ready"||o.status==="submitting"?a.jsx(Dx,{preview:o.preview,disabled:o.status==="submitting",submitLabel:d,onCancel:()=>i(!1),onSubmit:()=>p(o.preview)}):null,o.status==="done"?a.jsxs(a.Fragment,{children:[a.jsx("b",{children:"Review posted"}),a.jsxs("span",{className:"hint",children:[o.commentCount," comment",o.commentCount===1?"":"s",o.descriptionUpdated?" and the description update":""," reached GitHub."]}),o.reviewUrl?a.jsx("a",{href:o.reviewUrl,target:"_blank",rel:"noreferrer noopener",children:"View on GitHub"}):null,a.jsx("div",{className:"frow",style:{justifyContent:"flex-end"},children:a.jsx("button",{className:"btn ghost",type:"button","data-submitclose":"",onClick:()=>i(!1),children:"OK"})})]}):null,o.status==="partial"?a.jsxs(a.Fragment,{children:[a.jsx("b",{children:"Review posted, description failed"}),a.jsx("span",{className:"hint",children:o.error}),o.reviewUrl?a.jsx("a",{href:o.reviewUrl,target:"_blank",rel:"noreferrer noopener",children:"View on GitHub"}):null,a.jsxs("div",{className:"frow",style:{justifyContent:"flex-end"},children:[a.jsx("button",{className:"btn ghost",type:"button","data-submitclose":"",onClick:()=>i(!1),children:"Cancel"}),a.jsx("button",{className:"btn",type:"button",onClick:()=>{T.review(e).then(A=>D.getState().setSnapshot(A)).catch(()=>{}),u()},children:"Retry the description"})]})]}):null]}):null]})}function Dx({preview:e,disabled:n,submitLabel:t,onCancel:r,onSubmit:s}){const i=e.comments.length+(e.description?1:0);return e.disabledReason?a.jsxs(a.Fragment,{children:[a.jsx("b",{children:"Submit review"}),a.jsx("span",{className:"hint",children:e.disabledReason}),a.jsx("div",{className:"frow",style:{justifyContent:"flex-end"},children:a.jsx("button",{className:"btn ghost",type:"button","data-submitclose":"",onClick:r,children:"Cancel"})})]}):a.jsxs(a.Fragment,{children:[a.jsx("b",{children:"Submit review"}),e.alreadyPosted.length>0?a.jsxs("span",{className:"hint",children:[e.alreadyPosted.length," already posted — they won't be posted twice."]}):null,i>0?a.jsxs("ul",{children:[e.comments.map(o=>a.jsxs("li",{children:[a.jsx("span",{className:"cw",children:Mx(o)})," ",o.text.slice(0,90),o.location.kind==="inline"&&o.location.fallbackNote?a.jsx("div",{className:"hint",children:o.location.fallbackNote}):null,o.location.kind==="general"&&o.location.reason?a.jsx("div",{className:"hint",children:o.location.reason}):null]},o.threadId)),e.description?a.jsxs("li",{children:[a.jsx("span",{className:"cw",children:"PR description"})," updated text"]}):null]}):a.jsx("span",{className:"hint",children:"Nothing pending. Mark comments “For PR” or edit the description first."}),a.jsxs("div",{className:"frow",style:{justifyContent:"flex-end"},children:[a.jsx("button",{className:"btn ghost",type:"button","data-submitclose":"",onClick:r,children:"Cancel"}),i>0?a.jsx("button",{className:"btn",type:"button","data-submitgo":"",disabled:n,onClick:s,children:t}):null]})]})}const Fx=[{title:"Using the reader",body:"Select text to Explain it, Ask about it, or add a Note. An explanation is a card: use its controls for examples, diagrams and depth."},{title:"Cards",body:"Each card: − / + changes depth; add examples or a diagram; Undo; mark read (collapses it)."},{title:"Markers",body:"Small markers at the end of a paragraph: <> shows the cited code, the speech bubble shows comments. Hover to preview, click to open."},{title:"Findings",body:"Orange cards are the agent's own observations about the change. Open one to see the evidence."},{title:"Diff",body:"Filter files; Hide uninteresting collapses generated, import-only and docs hunks to one line; Fold all summarizes and folds every hunk. Per hunk: fold, summarize, note, mark reviewed. Click a line number to comment."},{title:"Comments",body:"The Comments menu (top of the source pane) lists every comment. “For PR” comments and description edits stay drafts until you click Submit review."},{title:"New commits",body:"When the branch moves, the diff pane shows what changed with an Update button, and stale cards offer the same update. Older versions stay viewable from the version switcher."},{title:"Settings",body:"Models per role, prompt templates with their expanded text, limits and budgets, running jobs with tokens and cache-hit rate, and the shared context agents build up."}];function Ix(){const[e,n]=h.useState(!1),t=h.useRef(null);return h.useEffect(()=>{if(!e)return;const r=i=>{var o;(o=t.current)!=null&&o.contains(i.target)||n(!1)},s=i=>{i.key==="Escape"&&n(!1)};return window.addEventListener("pointerdown",r),window.addEventListener("keydown",s),()=>{window.removeEventListener("pointerdown",r),window.removeEventListener("keydown",s)}},[e]),a.jsxs("span",{ref:t,style:{position:"relative",display:"inline-flex"},children:[a.jsxs("button",{className:"tbtn",type:"button","aria-expanded":e,"aria-label":"Usage tips",title:"Usage tips",onClick:()=>n(!e),children:[a.jsx(q,{name:"bulb"})," Tips"]}),e?a.jsx("div",{role:"dialog","aria-label":"Usage tips",className:"cmenu",style:{position:"absolute",left:0,top:"calc(100% + 4px)",width:340},children:Fx.map(r=>a.jsxs("div",{style:{padding:"4px 6px"},children:[a.jsx("b",{style:{fontSize:12.5},children:r.title}),a.jsx("p",{className:"hint",style:{margin:"2px 0 6px"},children:r.body})]},r.title))}):null]})}function Ox({reviewId:e,pendingCount:n,sourceOpen:t,onToggleSource:r}){var x;const s=D(w=>w.snapshot),[i,o]=h.useState(null);h.useEffect(()=>{let w=!1;return T.reviews().then(g=>{w||o(g.reviews.find(m=>m.id===e)??null)}).catch(()=>{}),()=>{w=!0}},[e]);const l=s==null?void 0:s.review.repoId,c=(i==null?void 0:i.prNumber)??(s==null?void 0:s.review.prNumber),d=(i==null?void 0:i.branch)??(s==null?void 0:s.review.branch)??"",u=(i==null?void 0:i.repoOwner)??(l==="demo"?"demo":null),f=(i==null?void 0:i.repoName)??(l==="demo"?"urllib3-5020":null),p=u&&f?c!==void 0?`${u}/${f}#${c}`:`${u}/${f}`:null,A=(x=s==null?void 0:s.pages.find(w=>w.kind==="root"))==null?void 0:x.title,v=i!=null&&i.title&&i.title!=="Guided review"?i.title:A&&A!=="Guided review"?A:d||e;return a.jsxs("header",{className:"top",children:[a.jsx(cn,{className:"brand",to:"/",title:"Back to the start screen",children:"Unvibe"}),a.jsxs("div",{className:"pr",children:[p?a.jsx("span",{className:"num",children:p}):null,a.jsx("b",{title:v,children:v})]}),a.jsx(Ix,{}),a.jsx(cn,{className:"tbtn",to:`/settings?review=${encodeURIComponent(e)}`,children:"Settings"}),a.jsx(Bx,{reviewId:e}),a.jsx("button",{className:"tbtn",id:"toggleRight",type:"button","aria-pressed":t,onClick:r,children:"Source"})]})}const Lu=900,Dh="unvibe.paneWidth";function Ur(e){return Math.max(320,Math.min(window.innerWidth-420,e))}function Hx(){try{const n=Number(localStorage.getItem(Dh));if(Number.isFinite(n)&&n>=320)return Ur(n)}catch{}const e=window.innerWidth;return Math.max(400,Math.min(820,Math.round(e*.42)))}function zx({reviewId:e}){const[n,t]=h.useState(null),[r,s]=h.useState(()=>Hx()),[i,o]=h.useState("diff"),l=h.useRef(null),c=n??window.innerWidth>=Lu,d=window.innerWidth>=Lu&&c,u=Sh(D(g=>g.snapshot)),[,f]=h.useState(0);h.useEffect(()=>{const g=()=>f(m=>m+1);return window.addEventListener("resize",g),()=>window.removeEventListener("resize",g)},[]),h.useEffect(()=>{const g=()=>{t(!0)};return window.addEventListener(Ht,g),()=>window.removeEventListener(Ht,g)},[]),h.useEffect(()=>{try{localStorage.setItem(Dh,String(r))}catch{}},[r]),h.useEffect(()=>{const g=()=>s(m=>m<window.innerWidth*.48?Ur(Math.round(window.innerWidth*.52)):m);return window.addEventListener(ol,g),()=>window.removeEventListener(ol,g)},[]);const p=h.useCallback(g=>{var m,k;l.current={x0:g.clientX,w0:r},(k=(m=g.target).setPointerCapture)==null||k.call(m,g.pointerId)},[r]),A=h.useCallback(g=>{const m=l.current;m&&s(Ur(m.w0+(m.x0-g.clientX)))},[]),v=h.useCallback(()=>{l.current=null},[]),x=h.useCallback(g=>{g.key==="ArrowLeft"?s(m=>Ur(m+40)):g.key==="ArrowRight"&&s(m=>Ur(m-40))},[]),w="col"+(d?"":c?" overlay":" hide");return a.jsxs("div",{className:"app",children:[a.jsx(Ox,{reviewId:e,pendingCount:u,sourceOpen:c,onToggleSource:()=>t(!c)}),a.jsxs("div",{className:"cols",style:{gridTemplateColumns:d?`minmax(0, 1fr) 6px ${r}px`:"minmax(0, 1fr)"},children:[a.jsx("main",{className:"col",id:"page",children:a.jsx(Iv,{reviewId:e})}),a.jsx("div",{id:"handle",role:"separator","aria-orientation":"vertical","aria-label":"Resize source pane",tabIndex:0,hidden:!d,onPointerDown:p,onPointerMove:A,onPointerUp:v,onKeyDown:x}),a.jsx("section",{className:w,id:"right","aria-label":"Description, files and diff",children:a.jsx(Rx,{reviewId:e,tab:i,onTab:o})})]})]})}function Ux(){const{id:e}=rc(),n=e??"demo",t=D(i=>i.applyEvent),r=D(i=>i.setConnected),s=D(i=>i.resyncSeq);return h.useEffect(()=>fh({reviewId:n,onEvent:t,onStatus:r}),[n,t,r]),h.useEffect(()=>{if(s===0)return;let i=!1;return T.review(n).then(o=>{i||D.getState().setSnapshot(o)}).catch(()=>{}),()=>{i=!0}},[n,s]),a.jsxs(a.Fragment,{children:[a.jsx(zx,{reviewId:n}),a.jsx(U2,{}),a.jsx(Q2,{}),a.jsx(ov,{}),a.jsx(lv,{}),a.jsx(g2,{}),a.jsx(_0,{})]})}function Wx({reviewId:e}){const[n,t]=h.useState(null),[r,s]=h.useState(null),i=h.useCallback(async()=>{if(e){s(null);try{t((await T.contributions(e)).contributions)}catch(l){s(V(l))}}},[e]);h.useEffect(()=>{t(null),i()},[i]);const o=async l=>{if(e)try{await T.deleteContribution(e,l),t(c=>c===null?c:c.filter(d=>d.id!==l))}catch(c){s(V(c))}};return a.jsxs("section",{"aria-label":"Shared context",id:"shared-context",children:[a.jsx("div",{className:"divider",children:"Shared context"}),e?r?a.jsx("p",{className:"err",children:r}):n===null?a.jsx("p",{className:"hint",children:"Loading contributions…"}):n.length===0?a.jsx("p",{className:"hint",children:"No contributions yet. Agent turns append facts, corrections, open questions and reader notes here."}):n.map(l=>a.jsx(Vx,{contribution:l,reviewId:e,onDelete:()=>void o(l.id)},l.id)):a.jsx("p",{className:"hint",children:"Open settings from a review (`/settings?review=:id`) to see its shared context."})]})}function Vx({contribution:e,reviewId:n,onDelete:t}){return a.jsxs("div",{className:"card",style:{padding:"8px 14px"},"data-testid":`contribution-${e.id}`,children:[a.jsxs("div",{className:"frow",style:{gap:8},children:[a.jsx("code",{className:"hint",children:e.id}),a.jsx("span",{className:`st ${e.status}`,children:e.status}),a.jsxs("span",{className:"hint",children:["from ",e.sourceSession]}),e.replaces?a.jsxs("span",{className:"hint",children:["replaces ",e.replaces]}):null,a.jsx("span",{className:"sp"}),a.jsx("button",{className:"x",type:"button","aria-label":`Delete ${e.id}`,onClick:t,children:"Delete"})]}),e.items.map((r,s)=>a.jsx(Kx,{item:r,reviewId:n,sourceSession:e.sourceSession},s))]})}function Kx({item:e,reviewId:n,sourceSession:t}){return a.jsxs("div",{style:{margin:"6px 0"},children:[a.jsxs("div",{className:"frow",style:{gap:8},children:[a.jsx("span",{className:"st",children:_x(e.kind)}),a.jsx("span",{className:"sp"}),a.jsx(Gx,{reviewId:n,sourceSession:t,target:e.target})]}),a.jsx("p",{style:{margin:"4px 0"},children:e.text}),e.target&&!Fh(e.target)?a.jsxs("p",{className:"hint",children:["target: ",e.target]}):null,e.citations.length>0?a.jsxs("p",{className:"hint",style:{margin:"2px 0"},children:["cites: ",e.citations.map(r=>r.target).join(", ")]}):null]})}function _x(e){switch(e){case"fact":return"fact";case"correction":return"correction";case"open_question":return"open question";case"reader_note":return"reader note"}}function Fh(e){return e.startsWith("card:")}function Gx({reviewId:e,sourceSession:n,target:t}){if(t&&Fh(t)){const r=t.slice(5).split("#")[0];return a.jsx(cn,{className:"x",to:`/review/${e}#C-${r}`,children:"Open card"})}return n.startsWith("t-")||n.startsWith("ann_")?a.jsxs(cn,{className:"x",to:`/review/${e}`,children:["Open thread ",n]}):null}function qx(){const[e,n]=h.useState(null),[t,r]=h.useState(null),[s,i]=h.useState(!1),o=h.useCallback(async l=>{i(!0),r(null);try{n(await T.readiness(l))}catch(c){r(V(c))}finally{i(!1)}},[]);return h.useEffect(()=>{o()},[o]),a.jsxs("section",{"aria-label":"Environment",id:"environment",style:{scrollMarginTop:12},children:[a.jsx("div",{className:"divider",children:"Environment"}),a.jsx("p",{className:"hint",children:"git, gh, d2 and the configured agent CLIs — the same checks as the front-screen callouts."}),t?a.jsxs("p",{className:"err",role:"alert",children:["Couldn't check the environment: ",t]}):null,!e&&!t?a.jsx("p",{className:"hint",children:"Checking environment…"}):null,e?a.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:6},children:[e.checks.map(l=>a.jsxs("div",{className:"card",style:{padding:"6px 12px"},"data-testid":`env-${l.id}`,children:[a.jsxs("div",{className:"frow",style:{gap:8,alignItems:"baseline"},children:[a.jsx("b",{style:{minWidth:140},children:l.label}),a.jsx("span",{className:"st","data-testid":`env-${l.id}-status`,"data-status":l.status,style:l.status==="ok"?{background:"var(--sunk)",color:"var(--muted)"}:l.status==="warning"?{background:"var(--note-soft)",color:"var(--note)"}:{background:"var(--warn-soft)",color:"var(--warn)"},children:l.status}),a.jsx("span",{style:{fontSize:13},children:l.summary})]}),l.fix?a.jsx("div",{className:"hint",children:l.fix}):null]},l.id)),a.jsxs("div",{className:"frow",style:{gap:8,alignItems:"center"},children:[a.jsx("button",{className:"btn ghost",type:"button",onClick:()=>void o(!0),disabled:s,children:s?"Checking…":"Re-check"}),e.cached?a.jsx("span",{className:"hint",children:"Cached · Re-check for a fresh probe."}):null]})]}):null]})}function Qx({reviewId:e}){const[n,t]=h.useState(null),[r,s]=h.useState(null),i=h.useCallback(async()=>{if(e){s(null);try{t((await T.jobs(e)).jobs)}catch(d){s(V(d))}}},[e]);h.useEffect(()=>{t(null),i()},[i]),h.useEffect(()=>e?fh({reviewId:e,onEvent:d=>t(u=>u===null?u:ju(u,d))}):()=>{},[e]);const o=async d=>{try{const u=await T.cancelJob(d);t(f=>f===null?f:ju(f,{type:"job",job:u.job}))}catch{await i()}},l=px(n??[]),c=fx(n??[]);return a.jsxs("section",{"aria-label":"Jobs",children:[a.jsx("div",{className:"divider",children:"Jobs"}),e?r?a.jsx("p",{className:"err",children:r}):n===null?a.jsx("p",{className:"hint",children:"Loading jobs…"}):n.length===0?a.jsx("p",{className:"hint",children:"No jobs for this review."}):a.jsxs("div",{className:"card",style:{padding:"4px 14px"},children:[n.map(d=>a.jsx(Zx,{job:d,onCancel:()=>void o(d.id)},d.id)),a.jsxs("div",{className:"frow",style:{gap:8,padding:"8px 0"},"data-testid":"jobs-totals",children:[a.jsxs("span",{className:"hint",children:["Totals: ",Un(l.input)," in · ",Un(l.output)," out ·"," ",Un(l.cached)," cached (",vc(c),")"]}),a.jsx("span",{className:"sp"}),a.jsx("button",{className:"x",type:"button",onClick:()=>void i(),children:"Refresh"})]})]}):a.jsx("p",{className:"hint",children:"Open settings from a review (`/settings?review=:id`) to see its jobs."})]})}function Zx({job:e,onCancel:n}){const[t,r]=h.useState(!1),[s,i]=h.useState(e.promptSnapshot??null),[o,l]=h.useState(null),c=async()=>{const u=!t;if(r(u),u&&s===null){l(null);try{i((await T.jobPrompt(e.id)).promptSnapshot)}catch(f){l(V(f))}}},d=e.state==="queued"||e.state==="running"||e.state==="backing-off";return a.jsxs("div",{className:"jobrow","data-testid":`job-${e.id}`,children:[a.jsxs("div",{className:"frow",style:{gap:8},children:[a.jsx("span",{className:"kind",children:e.kind}),a.jsx("span",{className:`st ${e.state}`,"data-state":e.state,children:e.state==="backing-off"?`backing-off · ${hx(e.nextRetryAt)}`:e.state}),a.jsxs("span",{className:"hint",children:[e.provider?`${e.provider}/`:"",e.model]}),a.jsx("span",{className:"sp"}),e.usage?a.jsxs("span",{className:"hint",children:[Un(e.usage.inputTokens)," in · ",Un(e.usage.outputTokens)," out ·"," ",vc(e.cacheHitRate)," cached"]}):a.jsx("span",{className:"hint",children:"no usage yet"})]}),a.jsxs("div",{className:"frow",style:{gap:8},children:[e.progress?a.jsx("span",{className:"hint",children:e.progress}):null,e.error&&e.state!=="backing-off"?a.jsx("span",{className:"err",children:e.error}):null,e.state==="backing-off"&&e.error?a.jsx("span",{className:"hint",children:e.error}):null,a.jsx("span",{className:"sp"}),a.jsx("button",{className:"x",type:"button","aria-expanded":t,onClick:()=>void c(),children:t?"Hide prompt":"Prompt"}),d?a.jsx("button",{className:"x",type:"button",onClick:n,children:"Cancel"}):null]}),t?o?a.jsx("p",{className:"err",children:o}):s!==null?a.jsx("pre",{className:"code",children:s}):a.jsx("p",{className:"hint",children:"Loading prompt…"}):null]})}const Qo=[{key:"sessionsPerProvider",label:"Concurrent sessions per provider",hint:"Integer 1–32 (default 4)."},{key:"inlineBudgetTokens",label:"Inline size budget (tokens)",hint:"L1 budget, ~40k default."},{key:"rebuildSupersededRatio",label:"Base-rebuild superseded ratio",hint:"Number in (0, 1] (default 0.2).",step:"0.01"},{key:"rebuildAppendedTokens",label:"Base-rebuild appended tokens",hint:"Tokens appended before rebuild (default 10k)."},{key:"cacheLifetimeMs",label:"Cache lifetime (ms)",hint:"Idle sessions close after this (default 5 min)."},{key:"idleExitMinutes",label:"Idle-exit (minutes)",hint:"Service exits after this long idle; 0 = never (default 10)."}];function Yx({settings:e,onSaved:n}){const[t,r]=h.useState({}),[s,i]=h.useState([]),[o,l]=h.useState(!1),[c,d]=h.useState(null),u=p=>t[p.key]??String(e[p.key]),f=async()=>{l(!0),i([]),d(null);const p={};for(const A of Qo){const v=(t[A.key]??"").trim();if(v==="")continue;const x=Number(v);if(!Number.isFinite(x)){i([`${A.key} must be a number`]),l(!1);return}p[A.key]=x}try{const A=await T.saveSettings(p);n(A),r({}),d("Saved")}catch(A){i(Xx(A))}finally{l(!1)}};return a.jsxs("section",{"aria-label":"Limits and budgets",children:[a.jsx("div",{className:"divider",children:"Limits and budgets"}),a.jsxs("div",{className:"card",style:{padding:"8px 14px"},children:[Qo.map(p=>a.jsxs("div",{className:"setgrid",children:[a.jsx("label",{htmlFor:`limit-${p.key}`,children:p.label}),a.jsxs("div",{className:"fld",children:[a.jsx("input",{id:`limit-${p.key}`,type:"number",step:p.step??"1",value:u(p),onChange:A=>r(v=>({...v,[p.key]:A.target.value}))}),a.jsx("span",{className:"hint",children:p.hint}),s.filter(A=>A.startsWith(String(p.key))).map(A=>a.jsx("span",{className:"err",role:"alert",children:A},A))]})]},p.key)),s.filter(p=>!Qo.some(A=>p.startsWith(String(A.key)))).map(p=>a.jsx("p",{className:"err",role:"alert",children:p},p)),a.jsxs("div",{className:"frow",style:{gap:8,marginTop:8},children:[a.jsx("button",{className:"btn",type:"button",disabled:o,onClick:()=>void f(),children:o?"Saving…":"Save limits"}),c?a.jsx("span",{className:"hint",children:c}):null]})]})]})}function Xx(e){var r;const t=(r=(e instanceof Error?e.message:String(e)).match(/\{.*\}$/))==null?void 0:r[0];if(t)try{const s=JSON.parse(t);if(Array.isArray(s.errors))return s.errors.map(String);if(s.error)return[s.error]}catch{}return[V(e)]}const Jx=[{role:"main",label:"Main",blurb:"Everything that needs the review's context."},{role:"small",label:"Small",blurb:"Hunk summaries, titles, contribution cleanup."},{role:"secondOpinion",label:"Second opinion",blurb:"A different model from main, for an independent take."}],Zo=["claude","codex"];function $x({settings:e,onSaved:n}){const[t,r]=h.useState({});return h.useEffect(()=>{let s=!1;return T.readiness().then(i=>{if(s)return;const o={};for(const l of i.checks)l.id.startsWith("agent:")&&(o[l.id.slice(6)]=l);r(o)}).catch(()=>{}),()=>{s=!0}},[]),a.jsxs("section",{"aria-label":"Models",id:"models",style:{scrollMarginTop:12},children:[a.jsx("div",{className:"divider",children:"Models"}),Jx.map(({role:s,label:i,blurb:o})=>a.jsx(ek,{role:s,label:i,blurb:o,settings:e,onSaved:n,status:t[s]},s)),e.secondOpinion.provider===e.main.provider&&e.secondOpinion.model===e.main.model?a.jsxs("p",{className:"warnline",role:"status",children:["Second opinion uses the same model as main (",e.main.provider,"/",e.main.model,") — pick a different one so the second opinion is actually independent."]}):null]})}function ek({role:e,label:n,blurb:t,settings:r,onSaved:s,status:i}){const o=r[e],[l,c]=h.useState(o.provider),[d,u]=h.useState(null),[f,p]=h.useState(null),[A,v]=h.useState(!1),[x,w]=h.useState(null);h.useEffect(()=>{c(r[e].provider)},[r,e]),h.useEffect(()=>{let y=!1;return u(null),p(null),T.models(l).then(C=>{y||u(C.models)}).catch(C=>{y||p(V(C))}),()=>{y=!0}},[l]);const g=Zo.includes(l)?Zo:[l,...Zo],m=d!==null&&f===null&&o.model!==""&&!d.includes(o.model),k=e==="secondOpinion"&&o.model==="",b=async y=>{v(!0),w(null);try{s(await T.saveSettings({[e]:y}))}catch(C){w(V(C))}finally{v(!1)}};return a.jsxs("div",{className:"card",style:{padding:"8px 14px"},"data-testid":`model-${e}`,children:[a.jsxs("div",{className:"frow",style:{gap:8},children:[a.jsx("b",{style:{minWidth:110},children:n}),a.jsx("span",{className:"hint",children:t})]}),k?a.jsx("p",{className:"hint",role:"status","data-testid":`model-${e}-unset`,style:{margin:"6px 0"},children:"Not set — second opinions need a second provider (Codex). Pick one below, or leave this unset; everything else works with one provider."}):null,m?a.jsxs("p",{className:"err",role:"alert","data-testid":`model-${e}-missing`,style:{margin:"6px 0"},children:["Saved model “",o.model,"” is no longer offered by ",o.provider," — pick one of the models below."]}):null,a.jsxs("div",{className:"setgrid",children:[a.jsx("label",{htmlFor:`prov-${e}`,children:"Provider"}),a.jsx("select",{id:`prov-${e}`,value:l,onChange:y=>{const C=y.target.value;c(C),b({provider:C,model:o.model})},children:g.map(y=>a.jsx("option",{value:y,children:y},y))}),a.jsx("label",{htmlFor:`model-${e}`,children:"Model"}),a.jsxs("div",{className:"fld",children:[f?a.jsx("span",{className:"err",role:"alert",children:f}):d===null?a.jsx("span",{className:"hint",children:"Loading models…"}):a.jsxs("select",{id:`model-${e}`,value:o.model,onChange:y=>void b({provider:o.provider,model:y.target.value}),disabled:A,children:[o.model===""?a.jsx("option",{value:"",children:"Not set"}):null,d.includes(o.model)?null:o.model!==""?a.jsxs("option",{value:o.model,children:[o.model," (current)"]}):null,d.map(y=>a.jsx("option",{value:y,children:y},y))]}),A?a.jsx("span",{className:"hint",children:"Saving…"}):null,x?a.jsx("span",{className:"err",role:"alert",children:x}):null,i&&i.status!=="ok"?a.jsxs("span",{className:i.status==="warning"?"warnline":"err",role:"status","data-testid":`model-${e}-status`,children:[i.summary,i.fix?` — ${i.fix}`:""]}):null,(i==null?void 0:i.status)==="ok"?a.jsx("span",{className:"hint","data-testid":`model-${e}-status`,children:i.summary}):null]})]})]})}function nk({reviewId:e}){const[n,t]=h.useState(null),[r,s]=h.useState(null);h.useEffect(()=>{let o=!1;return t(null),s(null),T.prompts(e??void 0).then(l=>{o||t(l)}).catch(l=>{o||s(V(l))}),()=>{o=!0}},[e]);const i=new Map(((n==null?void 0:n.expanded)??[]).map(o=>[o.name,o]));return a.jsxs("section",{"aria-label":"Prompts",children:[a.jsx("div",{className:"divider",children:"Prompts"}),r?a.jsx("p",{className:"err",children:r}):null,!n&&!r?a.jsx("p",{className:"hint",children:"Loading templates…"}):null,(n==null?void 0:n.templates.length)===0?a.jsx("p",{className:"hint",children:"No templates."}):null,((n==null?void 0:n.templates)??[]).map(o=>a.jsx(tk,{template:o,expanded:i.get(o.name),reviewId:e},o.name))]})}function tk({template:e,expanded:n,reviewId:t}){const[r,s]=h.useState("template"),[i,o]=h.useState(!1);return a.jsxs("div",{className:"card",style:{padding:"8px 14px"},"data-testid":`prompt-${e.name}`,children:[a.jsxs("div",{className:"frow",style:{gap:8},children:[a.jsx("button",{className:"ib",type:"button","aria-expanded":i,"aria-label":i?`Collapse ${e.name}`:`Expand ${e.name}`,onClick:()=>o(!i),children:i?"▾":"▸"}),a.jsx("code",{children:e.name}),a.jsxs("span",{className:"hint",children:[e.role," · ",e.tier]}),a.jsx("span",{className:"sp"}),i?a.jsxs("span",{className:"seg",role:"group","aria-label":`${e.name} view`,children:[a.jsx("button",{type:"button","aria-pressed":r==="template",onClick:()=>s("template"),children:"Template"}),a.jsx("button",{type:"button","aria-pressed":r==="expanded",disabled:!t,title:t?"The exact text that would be sent now":"Open settings from a review to expand",onClick:()=>s("expanded"),children:"Expanded for this review"})]}):null]}),i&&r==="template"?a.jsx(rk,{template:e}):null,i&&r==="expanded"?n?a.jsx(ak,{expanded:n}):a.jsx("p",{className:"hint",children:"No expansion for this review."}):null]})}function rk({template:e}){return a.jsxs("div",{children:[a.jsxs("p",{className:"hint",style:{margin:"6px 0"},children:["role: ",a.jsx("code",{children:e.role})," · tier: ",a.jsx("code",{children:e.tier})," · variables:"," ",e.variables.length>0?e.variables.map(n=>a.jsx("code",{children:`{{${n}}}`},n)).join(" "):"—"]}),a.jsx("pre",{className:"code",children:ok(e.template)})]})}const sk=/(\{\{[a-zA-Z0-9_.]+\}\})/g,ik=/^\{\{[a-zA-Z0-9_.]+\}\}$/;function ok(e){return e.split(sk).map((n,t)=>ik.test(n)?a.jsx("mark",{className:"tm",children:n},t):a.jsx("span",{children:n},t))}function ak({expanded:e}){const n=gx(e.expanded),t=e.layers.reduce((o,l)=>o+l.tokens,0),[r,s]=h.useState(!1),i=async o=>{try{await navigator.clipboard.writeText(o),s(!0),window.setTimeout(()=>s(!1),1200)}catch{}};return a.jsxs("div",{children:[a.jsxs("div",{className:"frow",style:{gap:8,margin:"6px 0"},children:[a.jsxs("span",{className:"hint",children:[Un(t)," total · ",Un(e.cachedTokens)," cached"]}),a.jsx("span",{className:"sp"}),a.jsx("button",{className:"x",type:"button",onClick:()=>void i(e.expanded),children:r?"Copied":"Copy all"})]}),n.map((o,l)=>o.layer===""?a.jsx("pre",{className:"code",children:o.text},l):a.jsxs("details",{className:`lay${o.cached?" cached":""}`,"data-layer":o.layer,children:[a.jsxs("summary",{children:[a.jsx("b",{children:o.layer}),a.jsx("span",{className:"hint",children:o.label}),a.jsx("span",{className:"hint",children:Un(o.tokens)}),o.cached?a.jsx("span",{className:"st running",children:"cached"}):null,a.jsx("span",{className:"sp"}),a.jsx("button",{className:"x",type:"button",onClick:c=>{c.preventDefault(),i(o.text)},children:"Copy"})]}),a.jsx("pre",{className:"code",children:o.text})]},`${o.layer}-${l}`))]})}function lk(){const[e]=xg(),n=e.get("review"),[t,r]=h.useState(null),[s,i]=h.useState(null);h.useEffect(()=>{let l=!1;T.settings().then(c=>{l||r(c)}).catch(c=>{l||i(V(c))});try{const c=window.location.hash;if(c){const d=window.setTimeout(()=>{var u;(u=document.querySelector(c))==null||u.scrollIntoView({block:"start"})},50);return()=>{l=!0,window.clearTimeout(d)}}}catch{}return()=>{l=!0}},[]);const o=n?`/review/${n}`:"/";return a.jsxs("div",{className:"app",children:[a.jsxs("header",{className:"top",children:[a.jsx(cn,{className:"brand",to:"/",title:"Back to the start screen",children:"Unvibe"}),a.jsx("div",{className:"pr",children:a.jsx("b",{children:"Settings"})}),a.jsx(cn,{className:"tbtn",to:o,children:n?"Back to review":"Back to start"})]}),a.jsx("main",{className:"col",style:{padding:24},children:a.jsxs("div",{className:"doc",children:[a.jsx("div",{className:"eyebrow",children:"Settings"}),a.jsx("h1",{className:"title",children:"Models, prompts, limits, jobs, shared context"}),s?a.jsxs("p",{className:"err",role:"alert",children:["Couldn't load settings: ",s]}):null,!t&&!s?a.jsx("p",{className:"hint",children:"Loading settings…"}):null,t?a.jsxs(a.Fragment,{children:[a.jsx($x,{settings:t,onSaved:r}),a.jsx(qx,{}),a.jsx(nk,{reviewId:n}),a.jsx(Yx,{settings:t,onSaved:r}),a.jsx(Qx,{reviewId:n}),a.jsx(Wx,{reviewId:n})]}):null]})})]})}const Tu="unvibe.start.repoId";function et(e,n){return`${e.kind}-${e.reviewId??e.prNumber??e.branch??n}`}function ck(e){const n=Date.now()-e;if(n<6e4)return"just now";if(n<36e5)return`${Math.floor(n/6e4)}m ago`;if(n<864e5)return`${Math.floor(n/36e5)}h ago`;if(n<864e5*30)return`${Math.floor(n/864e5)}d ago`;try{return new Date(e).toLocaleDateString()}catch{return""}}function dk(e){switch(e.guideStatus){case"ready":return"Guide ready";case"running":return uk(e.guideDetail);case"error":return"Guide didn't finish";case"disabled":return"Guide off";default:return"Guide not started"}}function uk(e){switch((e??"").replace(/^Running:\s*/i,"").split(",").map(r=>r.trim().toLowerCase()).find(r=>r!=="")){case"reader":return"Reading the change…";case"base":return"Preparing shared context…";case"critic":return"Checking findings…";case"concept":return"Writing concepts…";case"hunk-pass":return"Summarizing code…";case"go-deeper":return"Filling deeper cards…";case"explain":return"Writing an explanation…";case"ask":return"Answering a question…";case"depth":return"Rewriting depth…";case"examples":return"Adding examples…";case"diagram":return"Drawing a diagram…";case"second-opinion":return"Getting a second opinion…";case"update-pass":return"Updating for new commits…";case"summarize":return"Summarizing…";default:return"Working…"}}function fk(e,n,t){const r=e.trim();if(!r)return{error:"Enter a PR number or URL."};const s=r.match(/^#?(\d+)$/);if(s)return t?{repoId:t,pr:Number(s[1])}:{error:"Pick a repo first, then enter its PR number."};const i=r.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/pull\/(\d+)/i);if(i){const[,l,c,d]=i,u=n.find(f=>f.owner.toLowerCase()===l.toLowerCase()&&f.name.toLowerCase()===c.toLowerCase());return u?{repoId:u.id,pr:Number(d)}:{error:`Repo ${l}/${c} isn't in your list — add it by path first.`}}const o=r.match(/^([^/\s]+)\/([^/\s#]+)#(\d+)$/);if(o){const[,l,c,d]=o,u=n.find(f=>f.owner.toLowerCase()===l.toLowerCase()&&f.name.toLowerCase()===c.toLowerCase());return u?{repoId:u.id,pr:Number(d)}:{error:`Repo ${l}/${c} isn't in your list — add it by path first.`}}return{error:"Enter a PR number (e.g. 5020) or a GitHub PR URL."}}function pk(){const e=Qn(),[n,t]=h.useState([]),[r,s]=h.useState(()=>{try{const j=localStorage.getItem(Tu);return j&&j!=="demo"?j:null}catch{return null}}),[i,o]=h.useState([]),[l,c]=h.useState([]),[d,u]=h.useState([]),[f,p]=h.useState([]),[A,v]=h.useState(""),[x,w]=h.useState(null),[g,m]=h.useState(null),[k,b]=h.useState(null),[y,C]=h.useState(null),[S,N]=h.useState(null),[M,R]=h.useState(""),[O,_]=h.useState(null),[ae,le]=h.useState(null),[fn,qe]=h.useState(!1),z=h.useRef(null),B=h.useCallback(async()=>{try{const j=await T.reviews();m(j.reviews),b(null)}catch{b("Couldn't load previous reviews.")}},[]);h.useEffect(()=>{let j=!1;return T.repos().then(K=>{j||(t(K.repos),s(se=>{var Sn;return se&&se!=="demo"&&K.repos.some(Yn=>Yn.id===se)?se:((Sn=K.repos.find(Yn=>Yn.id!=="demo"))==null?void 0:Sn.id)??null}))}).catch(()=>{}),T.repoChanges("demo").then(K=>{j||p(K.changes.filter(se=>se.kind==="demo"))}).catch(()=>{}),B(),T.readiness().then(K=>{j||le(K.checks)}).catch(()=>{j||le(null)}),()=>{j=!0}},[B]),h.useEffect(()=>{try{r&&localStorage.setItem(Tu,r)}catch{}if(!r)return;let j=!1;return(async()=>{try{const[se,Sn,Yn]=await Promise.all([T.repoChanges(r,"authoring"),T.repoChanges(r,"review-requested"),T.repoChanges(r,"recent")]);if(j)return;o(se.changes),c(Sn.changes),u(Yn.changes.filter(io=>io.kind==="branch"))}catch{}})(),()=>{j=!0}},[r]);const U=h.useCallback(async(j,K)=>{w(j);try{const se=await T.createReview(K);await B(),e(`/review/${se.review.id}`)}catch(se){F(`Couldn't open the review: ${V(se)}`)}finally{w(null)}},[e,B]),W=h.useCallback(async()=>{const j=A.trim();if(j)try{const K=await T.addRepo({path:j});t(K.repos);const se=K.repos.find(Sn=>Sn.localPath===j)??K.repos[0];se&&s(se.id),v("")}catch(K){F(`Couldn't add that repo: ${V(K)}`)}},[A]),ne=h.useCallback(async j=>{N(j);try{await T.deleteReview(j),m(K=>K&&K.filter(se=>se.id!==j)),C(null)}catch(K){F(`Couldn't remove the review: ${V(K)}`)}finally{N(null)}},[]),fe=h.useCallback(async()=>{qe(!0);try{const j=await T.readiness(!0);le(j.checks)}catch(j){F(`Couldn't re-check: ${V(j)}`)}finally{qe(!1)}},[]),Me=h.useCallback(()=>{const j=fk(M,n,r);if("error"in j){_(j.error);return}_(null),U(`pr-${j.pr}`,{repoId:j.repoId,pr:j.pr})},[M,n,r,U]),Ee=h.useCallback(()=>{var j;(j=z.current)==null||j.scrollIntoView({behavior:"smooth",block:"start"})},[]),pn=n.filter(j=>!j.detected&&j.id!=="demo"),nn=n.filter(j=>j.detected&&j.id!=="demo"),ze=(ae??[]).filter(j=>j.status!=="ok"),yt=ze.find(j=>j.id==="gh"),Zn=ze.find(j=>j.id==="agent:main"),Sr=ae!==null&&ze.length===0;return a.jsxs("div",{className:"app",children:[a.jsxs("header",{className:"top",children:[a.jsxs("div",{className:"pr",children:[a.jsx(cn,{className:"brand",to:"/",children:"Unvibe"}),Sr?a.jsx("span",{className:"hint","data-testid":"readiness-ready",children:"Ready · gh + agents ok"}):null]}),a.jsx(cn,{className:"tbtn",to:"/settings",children:"Settings"})]}),a.jsx("main",{className:"col",style:{padding:24},children:a.jsxs("div",{className:"doc",style:{maxWidth:760},children:[ze.length>0?a.jsxs("div",{"aria-label":"Environment problems",style:{display:"flex",flexDirection:"column",gap:6,marginBottom:8},children:[ze.map(j=>a.jsxs("div",{className:"ci","data-testid":`readiness-callout-${j.id}`,style:{border:"1px solid var(--line)",alignItems:"center"},children:[a.jsxs("div",{style:{minWidth:0},children:[a.jsxs("div",{style:{fontSize:13},children:[a.jsxs("b",{children:[j.label,":"]})," ",j.summary]}),j.fix?a.jsx("div",{className:"hint",children:j.fix}):null]}),a.jsx("div",{className:"frow",style:{gap:6},children:a.jsx(cn,{className:"tbtn",to:`/settings${j.settingsAnchor??"#environment"}`,children:"Settings"})})]},j.id)),a.jsx("div",{children:a.jsx("button",{className:"mini",type:"button",onClick:()=>void fe(),disabled:fn,children:fn?"Checking…":"Re-check"})})]}):null,a.jsx("div",{className:"eyebrow",children:"Unvibe"}),a.jsx("h1",{className:"title",children:"Reviews"}),g===null&&!k?a.jsx("p",{className:"hint",children:"Loading previous reviews…"}):k?a.jsx("p",{className:"hint",role:"alert",children:k}):g.length===0?a.jsxs("div",{"data-testid":"sessions-empty",children:[a.jsx("p",{className:"hint",style:{fontSize:13,color:"var(--ink)"},children:"Unvibe reads a branch or pull request with an agent alongside, keeping explanations tied to the code."}),a.jsx("p",{className:"hint",children:"Open your first review below — pick a repo, a PR or a branch, or try the demo."}),a.jsx("button",{className:"btn",type:"button",onClick:Ee,children:"New review"})]}):a.jsx("div",{"aria-label":"Prior reviews",style:{display:"flex",flexDirection:"column",gap:2},children:g.map(j=>a.jsxs("div",{className:"ci","data-testid":`session-${j.id}`,children:[a.jsxs("button",{className:"cj",type:"button",disabled:x!==null||S!==null,onClick:()=>e(`/review/${j.id}`),title:`${j.title} (${j.branch})`,children:[a.jsxs("span",{className:"cw",children:[j.repoOwner,"/",j.repoName," · ",j.prNumber?`#${j.prNumber}`:j.branch,j.currentVersion>1?` · v${j.currentVersion}`:""," · ",ck(j.lastOpened)]}),a.jsx("span",{className:"cx2",children:j.title}),a.jsxs("span",{className:"hint",children:[j.reviewedHunks,"/",j.totalHunks," hunks reviewed",j.pendingComments>0?` · ${j.pendingComments} pending`:""," · ",dk(j)]})]}),a.jsxs("div",{className:"frow",style:{gap:4,alignItems:"center"},children:[j.stale?a.jsx("span",{className:"prtag",children:"new commits · Update"}):null,y===j.id?a.jsxs(a.Fragment,{children:[a.jsx("span",{className:"hint",children:"Remove local data only?"}),a.jsx("button",{className:"btn",type:"button",disabled:S===j.id,onClick:()=>void ne(j.id),children:S===j.id?"Removing…":"Remove"}),a.jsx("button",{className:"btn ghost",type:"button",disabled:S===j.id,onClick:()=>C(null),children:"Keep"})]}):a.jsx("button",{className:"mini",type:"button","aria-label":`Remove ${j.title}`,disabled:S!==null,onClick:()=>C(j.id),title:"Remove this review's local data (never touches GitHub or your checkout; deletes the managed worktree)",children:"Remove"})]})]},j.id))}),a.jsxs("div",{ref:z,id:"new-review",style:{scrollMarginTop:12},children:[a.jsx("div",{className:"divider",children:"New review"}),Zn?a.jsxs("p",{className:"hint","data-testid":"newreview-agent-hint",children:["Main agent not ready (",Zn.summary,") — the guide may not generate. You can still open the diff and comment."]}):null,f.length>0?a.jsxs(a.Fragment,{children:[a.jsx("div",{className:"divider",children:"Try the demo"}),f.map((j,K)=>a.jsxs("div",{className:"ci",children:[a.jsxs("button",{className:"cj",type:"button",disabled:x!==null,onClick:()=>void U(et(j,K),{repoId:"demo"}),children:[a.jsx("span",{className:"cw",children:"Demo · no tokens"}),a.jsx("span",{className:"cx2",children:j.title})]}),x===et(j,K)?a.jsx("span",{className:"hint",children:"Opening…"}):null]},et(j,K)))]}):null,a.jsx("div",{className:"divider",children:"Repositories"}),a.jsxs("div",{className:"frow",style:{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8},children:[a.jsx("input",{type:"text","aria-label":"Add a repo by path",placeholder:"/path/to/checkout",value:A,onChange:j=>v(j.target.value),onKeyDown:j=>{j.key==="Enter"&&W()},style:{flex:"1 1 220px",border:"1px solid var(--line)",borderRadius:6,padding:"3px 8px"}}),a.jsx("button",{className:"btn",type:"button",onClick:()=>void W(),children:"Add by path"})]}),n.length===0?a.jsx("p",{className:"hint",children:"No repos yet. Add a checkout by path."}):a.jsxs(a.Fragment,{children:[pn.length>0?a.jsx("div",{className:"frow",role:"group","aria-label":"Recent repos",style:{display:"flex",gap:4,flexWrap:"wrap"},children:pn.map(j=>a.jsx(Ru,{repo:j,selected:j.id===r,onSelect:s},j.id))}):null,nn.length>0?a.jsxs(a.Fragment,{children:[a.jsx("p",{className:"hint",style:{margin:"8px 0 4px"},children:"Detected checkouts"}),a.jsx("div",{className:"frow",role:"group","aria-label":"Detected checkouts",style:{display:"flex",gap:4,flexWrap:"wrap"},children:nn.map(j=>a.jsx(Ru,{repo:j,selected:j.id===r,onSelect:s},j.id))})]}):null]}),a.jsx("div",{className:"divider",children:"Open a PR by URL or number"}),a.jsxs("div",{className:"frow",style:{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8},children:[a.jsx("input",{type:"text","aria-label":"Open a PR by URL or number",placeholder:"PR number (5020) or owner/repo pull URL",value:M,onChange:j=>{R(j.target.value),_(null)},onKeyDown:j=>{j.key==="Enter"&&Me()},style:{flex:"1 1 220px",border:"1px solid var(--line)",borderRadius:6,padding:"3px 8px"}}),a.jsx("button",{className:"btn",type:"button",onClick:Me,disabled:x!==null,children:"Open PR"})]}),O?a.jsx("p",{className:"hint",role:"alert",children:O}):null,yt?a.jsxs("p",{className:"hint","data-testid":"newreview-gh-hint",children:["PR lists need gh (",yt.summary,"). You can still open a local branch below or a PR by number once gh works."]}):null,r&&r!=="demo"?a.jsxs(a.Fragment,{children:[a.jsx(Yo,{title:"PRs you're authoring",changes:i,opening:x,empty:"Nothing found.",onOpen:(j,K)=>U(et(j,K),{repoId:r,pr:j.prNumber,branch:j.branch})}),a.jsx(Yo,{title:"Waiting on your review",changes:l,opening:x,empty:"Nothing waiting.",onOpen:(j,K)=>U(et(j,K),{repoId:r,pr:j.prNumber,branch:j.branch})}),a.jsx(Yo,{title:"Recent branches",changes:d,opening:x,empty:"No branches.",onOpen:(j,K)=>U(et(j,K),{repoId:r,branch:j.branch})})]}):null]})]})})]})}function Ru({repo:e,selected:n,onSelect:t}){return a.jsxs("button",{className:"chip",type:"button","aria-pressed":n,title:e.localPath,onClick:()=>t(e.id),children:[e.owner,"/",e.name]})}function Yo({title:e,changes:n,opening:t,empty:r,onOpen:s}){return a.jsxs(a.Fragment,{children:[a.jsx("div",{className:"divider",children:e}),n.length===0?a.jsx("p",{className:"hint",children:r}):n.map((i,o)=>a.jsxs("div",{className:"ci",children:[a.jsxs("button",{className:"cj",type:"button",disabled:t!==null,onClick:()=>s(i,o),children:[a.jsxs("span",{className:"cw",children:[i.kind==="pr"?`#${i.prNumber} · ${i.branch}`:i.branch,i.author?` · ${i.author}`:""]}),a.jsx("span",{className:"cx2",children:i.title})]}),t===et(i,o)?a.jsx("span",{className:"hint",children:"Opening…"}):null]},et(i,o)))]})}function hk(){return a.jsx(mg,{children:a.jsxs(ag,{children:[a.jsx(ai,{path:"/",element:a.jsx(pk,{})}),a.jsx(ai,{path:"/review/:id/*",element:a.jsx(Ux,{})}),a.jsx(ai,{path:"/settings",element:a.jsx(lk,{})})]})})}H0();"serviceWorker"in navigator&&window.addEventListener("load",()=>{navigator.serviceWorker.register("/sw.js").catch(()=>{})});const Ih=document.getElementById("root");if(!Ih)throw new Error("#root not found");_p(Ih).render(a.jsx(Gt.StrictMode,{children:a.jsx(hk,{})}));
