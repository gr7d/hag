import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Server as WebSocketServer } from "ws"; // @TODO: write own implementation

const ws = new WebSocketServer({ noServer: true });

type Page = {
    template: string;
    endpoints?: object;
    exposures?: object;
    script?: string;
    styles: string[];
    style: string;
    callListener(req: http.IncomingMessage, res: Response): void;
};

type Pages = {
    [key: string]: any;
};

export type SessionStorage = {
    [key: string]: any;
}

type SessionPages = {
    [key: string]: Page;
}

type Session = {
    pages: SessionPages;
    storage: SessionStorage;
    exposureApp: any;
    outputAtCall: string;
}

type Sessions = {
    [key: string]: Session;
};

type Scripts = {
    [key: string]: string;
};

type ExposureConnections = {
    [key: string]: {
    [key: string]: string[];
};
};

type FileContentCache = {
    [key: string]: string;
};

type RenderedOutputCache = {
    [key: string]: string;
};

type ExposureApps = {
    [key: string]: any;
};

type Statics = {
    [key: string]: string;
};

type Functionates = {
    [key: string]: (req: http.IncomingMessage, res: Response) => any;
};

type Response = http.IncomingMessage & {
    send(text: string): any,
    setCookie(name: string, value: string): any,
    redirect(destination: string): any;
}

export type EndpointFunction = (storage: SessionStorage, req: http.IncomingMessage, res: http.ServerResponse) => any;

function getExposureCodeFromExposureApp(exposureApp: { [key: string]: any }) {
    return `
        var app = ${JSON.stringify(exposureApp)};
        Object.keys(app).forEach(exposureKey => {
            app[exposureKey] = eval(app[exposureKey]);
        });
    `
}

export function html(templates: any): string {
    // return templates.join("").replace(/\{\{((.|\n|\r|\s)*)\}\}/gm, (match: string, expression: string) => {
    //     return eval(`this.storage = { isLoggedIn: true };` + expression);
    // });
    return templates.join("");
}

export class Pag {
    public storage: SessionStorage = {};
    public style = "";
    public callListener: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => null;

    constructor(storage?) {
    this.storage = storage;
}

public addIntervalFunction(callback: () => any, interval: number): void {
    callback.bind(this)();
    setInterval(callback.bind(this), interval);
}

public addStyle(source: string): void {
    try {
        const fileContent = fs.readFileSync(source, "utf-8");

        if (!this.style.includes(fileContent))
this.style += fileContent;
}catch(_) {}
}

public listenToCall(listener: (req?: http.IncomingMessage, res?: http.ServerResponse) => void): void {
    this.callListener = listener;
}

public include(source: string | any): string | ((localVariables: { [key: string]: any }) => string) {
    if (typeof source === "string") {
        const fileEnding = source.replace(/(.*?)\./, "");
        let startTag = "";
        let endTag = "";

        switch (fileEnding) {
            case "css":
                startTag = "<style>";
                endTag = "</style>";
                break;
            case "js":
                startTag = "<script>";
                endTag = "</script>";
                break;
        }

        try {
            return startTag + (fs.readFileSync(source, "utf-8") || "") + endTag;
        }catch(error) {
            return "";
        }
    }else {
        const IncludedPage: (storage: SessionStorage, localVariables: { [key: string]: any }) => void = source;

        return (localVariables?: { [key: string]: any }) => {
            const page: Page = new IncludedPage({}, localVariables);
            const exposureApp = {};
            Object.keys((page.exposures || {})).map(exposureKey => {
                exposureApp[exposureKey] = page.exposures[exposureKey].toString().replace(/^.*?(\((.*))(?={)/, "$1=> ");
            });

            let script = "";
            return page.template
                    .replace(/@on([a-zA-Z]*?)="(.*?)"/g, (match: string, event: string, functionName: string): string => {
                        script += `/*LISTENER_START*/
                            Array.from(document.querySelectorAll("[data-bind-${functionName}]")).forEach(listener => {
                                listener.addEventListener("${event}", app.${functionName});
                            });
                        /*LISTENER_END*/`;
                        return `data-bind-${functionName}`;
                    })
                    .replace(/{{((.|\n|\r)*?)}}/gm, (match: string, expression: string) => {
                        return new Function(`return ${expression}`).bind(page)();
                    })
                + `<script-due-to-include>
                    app = {
                        ...app,
                        ...${JSON.stringify(exposureApp)}
                    };
                    Object.keys(app).forEach(exposureKey => {
                        // if (typeof app[exposureKey] === "string") {
                            app[exposureKey] = eval(app[exposureKey]);
                        // }
                    });
                    ${script}
                </script-due-to-include>`;
        }
    }
}
}

export class Hag {
    private server: http.Server;
    private statics: Statics = {};
    private pages: Pages = {};
    private scripts: Scripts = {};
    private sessions: Sessions = {};
    private functionates: Functionates = {};
    private exposureConnections: ExposureConnections = {};
    private fileContentCache: FileContentCache = {};
    private renderedOutputCache: RenderedOutputCache = {};
    private sessionCookieName: string = "ABCSESSION";
    private sessionRenewalHandler: (storage: SessionStorage, req: http.IncomingMessage) => boolean = () => true;

    private getObjectFromCookies(cookies: string): object {
        return cookies && cookies.split(";").reduce((cookies: any, cookie: string): any => {
            return {
                ...cookies,
                [cookie.split("=")[0].trimLeft()]: cookie.split("=")[1]
            };
        }, {}) || {};
    }

    private getFreeSessionID(): any {
        let sessionID = "";

        while (!sessionID || this.sessions[sessionID] || sessionID.length < 200)
            sessionID += Math.random().toString(36).substring(3);

        return sessionID;
    }

    private getFileContent(path: string): string {
        try {
            return fs.readFileSync(path, "utf-8");
        }catch(error) {
            return "";
        }
    }

    private initializeWebSocketConnection(req, socket): void {
        const acceptValue = crypto
            .createHash('sha1')
            .update(req.headers['sec-websocket-key'] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest('base64');

        socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Protocol: json\r\n' +
            'Sec-WebSocket-Accept: ' + acceptValue + '\r\n'
            + '\r\n');
        socket.pipe(socket);
    }

    private getExposureApp(pageSession: Page) {
        const app = {};
        Object.keys((pageSession.exposures)).map(exposureKey => {
            app[exposureKey] = pageSession.exposures[exposureKey].toString().replace(/^.*?(\((.*))(?={)/, "$1=> ");
        });

        return app;
    }

    private handleWebSocketConnection(socket, pageURL, pageSession, session): void {
        let lastHTML: string = session.outputAtCall;

        setInterval(() => {
            if (session.storage.lastCalledPage !== pageURL) return;
            let pageSessionTemplate: string = this.renderHTMLOutput(pageSession.template, pageURL, pageSession, true);

            if (lastHTML === pageSessionTemplate) return;
            lastHTML = pageSessionTemplate;

            const listeners: string = (this.scripts[pageURL].match(/\/\*LISTENER_START\*\/((.|\n)*?)\/\*LISTENER_END\*\//gm) || []).join("");
            let includedPageScript = "";
            pageSessionTemplate = pageSessionTemplate.replace(/<script-due-to-include>((.|\n)*?)<\/script-due-to-include>/gm, (match: string, includeScript: string) => {
                if (!includedPageScript.includes(includeScript))
                    includedPageScript += includeScript;

                return "";
            });

            socket.send(pageSessionTemplate + `|END_HTML|${includedPageScript}${listeners}`);
        }, 50);
    }

    private async renewSession(parsedRequest, parsedResponse): Promise<void> {
        if (!this.getObjectFromCookies(parsedRequest.headers.cookie)[this.sessionCookieName]) return;

        if (!await this.sessionRenewalHandler(parsedRequest, parsedResponse)) {
            delete this.sessions[this.getObjectFromCookies(parsedRequest.headers.cookie)[this.sessionCookieName]];
            return;
        }

        const oldSessionID = this.getObjectFromCookies(parsedRequest.headers.cookie)[this.sessionCookieName];
        const newSessionID = this.getFreeSessionID();

        this.sessions[newSessionID] = this.sessions[oldSessionID];
        delete this.sessions[oldSessionID];

        parsedResponse.setCookie(this.sessionCookieName, newSessionID);
    }

    private renderHTMLOutput(syntaxHTML: string, pageURL: string, pageSession: Page, processIncludeScriptManually: boolean = false): string {
        const exposureConnectionsOnCall = this.exposureConnections;
        const renderedPageOutputCache = this.renderedOutputCache[pageURL + JSON.stringify(pageSession) + JSON.stringify(pageSession)];

        // does this even work? maybe youre calculating it based on the req object, e.x. get parameters
        // maybe i should also add JSON.stringify(req) to the key

        // if (renderedPageOutputCache)
        //     return renderedPageOutputCache;

        const renderedHTML = (() => {
            if (processIncludeScriptManually) {
                return `<style>${pageSession.style}</style>`
                    +
                    syntaxHTML
                        .replace(/@on([a-zA-Z]*?)="(.*?)"/g, (match: string, event: string, functionName: string): string => {
                            return `data-bind-${functionName}`;
                        })
                        .replace(/{{((.|\n|\r)*?)}}/gm, (match: string, expression: string) => {
                            return new Function(`return ${expression}`).bind(pageSession)();
                        })
                    +
                    `<script async defer src="${pageURL}script"></script>`;
            }else {
                return `<style>${pageSession.style}</style>`
                    +
                    syntaxHTML
                        .replace(/@on([a-zA-Z]*?)="(.*?)"/g, (match: string, event: string, functionName: string): string => {
                            return `data-bind-${functionName}`;
                        })
                        .replace(/{{((.|\n|\r)*?)}}/gm, (match: string, expression: string) => {
                            return new Function(`return ${expression}`).bind(pageSession)();
                        })
                        .replace(/<script-due-to-include>((.|\n)*?)<\/script-due-to-include>/gm, (match: string, includeScript: string) => {
                            if (!this.scripts[pageURL].includes(includeScript))
                                this.scripts[pageURL] += includeScript;

                            return "";
                        })
                    +
                    `<script async defer src="${pageURL}script"></script>`;
            }
        })();

        this.renderedOutputCache[pageURL + JSON.stringify(pageSession) + JSON.stringify(pageSession)] = renderedHTML;
        return renderedHTML;
    }

    private getParsedPageURL(url: string): string {
        return (url.match(/(^\/([a-zA-Z0-9-_]*)|^\/)/)?.[0] || "")
            .replace(/(\/$|$)/, "/")
            .replace(/(api(.*)|script(.*))/, "");
    }

    private getParsedAPIURL(url: string): string {
        return url.includes("api/") && url.match(/api\/([a-zA-Z0-9-_]*)/)?.[1];
    }

    private getParsedURLQuery(url: string): object {
        const queryURL = url.replace(/(.*)\?/, "");
        const queryString = queryURL.split("&");

        return queryString.reduce((queries: object, query: string): object => {
            if (!query)
                return queries;

            return {
                ...queries,
                [query.split("=")?.[0]]: query.split("=")?.[1]
            }
        }, {});
    }

    async parseURLParameters(req: http.IncomingMessage): Promise<http.IncomingMessage> {
        switch (req.method) {
            case "GET":
                req["query"] = this.getParsedURLQuery(req.url);
                return req;
            case "POST":
                return await new Promise((resolve: (value: any) => void) => {
                    let body: object | string = "";

                    req.on("data", chunk => body += chunk.toString());
                    req.on("end", () => {
                        try {
                            body = JSON.parse(body.toString());
                        }catch(error) {
                            if (body.toString().includes(`name="`)) {
                                body = body.toString().match(/name="(.*?)"(\s|\n|\r)*(.*)(\s|\n|\r)*---/gm)
                                    .reduce((fields: object, field: string): object => {
                                        return {
                                            ...fields,
                                            [/name="(.*?)"/.exec(field)?.[1]]: field.match(/(.*?)(?=(\s|\n|\r)*---)/)[0]
                                        }
                                    }, {});
                            }
                        }

                        req["body"] = body;
                        resolve(req);
                    });
                });
        }

        return req;
    }

    private async parseRequest(req: http.IncomingMessage): Promise<http.IncomingMessage & any> {
        req = await this.parseURLParameters(req);
        req["cookies"] = this.getObjectFromCookies(req.headers.cookie);

        return req;
    }

    private async parseResponse(res: http.ServerResponse): Promise<http.ServerResponse & any> {
        res["send"] = (text: string) => res.end(text);
        res["setCookie"] = (name: string, value: string) => res.setHeader("Set-Cookie", `${name}=${value}`);
        res["redirect"] = (destination: string) => {
            res.writeHead(302, {
                location: destination
            });
            res.end();
        }

        return res;

        // return <http.ServerResponse & any>{
        //     setHeader: res.setHeader,
        //     statusCode: res.statusCode,
        //     close() {
        //         res.end();
        //     },
        //     send(text: string) {
        //         res.end(text);
        //     },
        //     setCookie(name: string, value: string): void {
        //         res.setHeader("Set-Cookie", `${name}=${value}`);
        //     },
        //     // @TODO: make redirect actually work lol
        //     redirect(destination: string): void {
        //         res.writeHead(302, {
        //             location: destination
        //         });
        //         res.end();
        //     }
        // }
    }

    private async handleAPIRequest(request: any, response: any, pageURL: string): Promise<void> {
        if (!this.pages[pageURL]) {
            request.statusCode = 404;
            request.send("No route found");
            return;
        }

        response.setHeader("Access-Control-Allow-Origin", "*");

        const endpoint = request.url.match(/api\/([a-zA-Z0-9-_]*)/)?.[1];
        const { pageSession } = this.getPage(pageURL, request.headers.cookie);

        if (!pageURL || !endpoint || !pageSession || !pageSession?.endpoints?.[request.method]?.[endpoint]) {
            response.statusCode = 404;
            response.send("No endpoint found");
            return;
        }

        response.send(
            JSON.stringify(
                await pageSession?.endpoints[request.method][endpoint].bind(pageSession)(request, response)
            )
        );
    }

    private getPage(pageURL: string, cookieString: string): { sessionID: string; session: Session; pageSession: Page } {
        const Page: any = this.pages[pageURL];

        if (!Page) return;

        const sessionID: string = this.getObjectFromCookies(cookieString)[this.sessionCookieName] || this.getFreeSessionID();
        const session: Session = this.sessions[sessionID] || (this.sessions[sessionID] = { pages: {}, storage: {}, exposureApp: {}, outputAtCall: "" });
        const pageSession: Page = session.pages[pageURL] || (session.pages[pageURL] = new Page(session.storage, {}, {}));

        return { sessionID, session, pageSession };
    }

    constructor() {
        this.server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
            const { url, method, headers } = req;

            const pageURL = this.getParsedPageURL(url);
            const parsedRequest = await this.parseRequest(req);
            const parsedResponse: Response = await this.parseResponse(res);

            if (this.statics[url]) {
                // @TODO: make dynamic
                res.setHeader("content-type", "text/javascript");
                parsedResponse.send(this.statics[url]);
                return;
            }

            if (this.functionates[url]) {
                this.functionates[url](parsedRequest, parsedResponse);
                return;
            }

            if (url.includes("/api")) {
                await this.handleAPIRequest(parsedRequest, parsedResponse, pageURL);
                return;
            }

            if (!this.pages[pageURL]) {
                parsedResponse.statusCode = 404;
                parsedResponse.send("No route found");
                return;
            }

            if (url.endsWith("/script")) {
                parsedResponse.send(this.scripts[pageURL]);
                return;
            }

            const { sessionID, session, pageSession } = this.getPage(pageURL, req.headers.cookie);

            // @TODO: maybe make this better
            // if (res.headersSent) return;

            parsedResponse.setCookie(this.sessionCookieName, sessionID);

            session.storage.lastCalledPage = pageURL;
            await this.renewSession(parsedRequest, parsedResponse);
            res.setHeader("content-type", "text/html");
            const outputAtCall = this.renderHTMLOutput(pageSession.template, pageURL, pageSession);
            session.outputAtCall = outputAtCall;
            pageSession.callListener(parsedRequest, parsedResponse);
            res.end(outputAtCall);
        });

        this.server.on("upgrade", (req, socket) => {
            if (req.headers["upgrade"] === "websocket") {
                const pageURL = req.url.replace(/(api(.*)|script(.*))/, "").endsWith("/") ? req.url.replace(/(api(.*)|script(.*))/, "") : req.url.replace(/(api(.*)|script(.*))/, "") + "/";
                const Page: any = this.pages[pageURL];
                const sessionID: string = this.getObjectFromCookies(req.headers.cookie)[this.sessionCookieName] || this.getFreeSessionID();
                const session: Session = this.sessions[sessionID];

                if (!session) return;

                const pageSession: Page = session.pages[pageURL];

                ws.handleUpgrade(req, req.socket, Buffer.alloc(0), (socket: any) => this.handleWebSocketConnection(socket, pageURL, pageSession, session));
                return;
            }
        });
    }

    public serve(url: string, path: string): void {
        this.statics[url] = this.getFileContent(path);
    }

    public functionate(url: string, callback: (req: http.IncomingMessage, res: Response) => any) {
        this.functionates[url] = callback;
    }

    public register(pageURL: string, Page: any) {
        if (this.pages[pageURL]) {
            console.warn(`${pageURL} is already in use.`);
            return;
        }

        if (!pageURL.startsWith("/")) {
            console.warn("Routes must start with a slash.");
            return;
        }

        if (!pageURL.endsWith("/")) pageURL += "/";
        this.pages[pageURL] = Page;
        const page = new Page({}, {}, { redirect: () => null });

        this.exposureConnections[pageURL] = {};
        let script = `var __extends,__assign,__rest,__decorate,__param,__metadata,__awaiter,__generator,__exportStar,__values,__read,__spread,__spreadArrays,__await,__asyncGenerator,__asyncDelegator,__asyncValues,__makeTemplateObject,__importStar,__importDefault,__classPrivateFieldGet,__classPrivateFieldSet;!function(e){var t="object"==typeof global?global:"object"==typeof self?self:"object"==typeof this?this:{};function r(e,r){return e!==t&&("function"==typeof Object.create?Object.defineProperty(e,"__esModule",{value:!0}):e.__esModule=!0),function(t,n){return e[t]=r?r(t,n):n}}"function"==typeof define&&define.amd?define("tslib",["exports"],function(n){e(r(t,r(n)))}):"object"==typeof module&&"object"==typeof module.exports?e(r(t,r(module.exports))):e(r(t))}(function(e){var t=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t}||function(e,t){for(var r in t)t.hasOwnProperty(r)&&(e[r]=t[r])};__extends=function(e,r){function n(){this.constructor=e}t(e,r),e.prototype=null===r?Object.create(r):(n.prototype=r.prototype,new n)},__assign=Object.assign||function(e){for(var t,r=1,n=arguments.length;r<n;r++)for(var o in t=arguments[r])Object.prototype.hasOwnProperty.call(t,o)&&(e[o]=t[o]);return e},__rest=function(e,t){var r={};for(var n in e)Object.prototype.hasOwnProperty.call(e,n)&&t.indexOf(n)<0&&(r[n]=e[n]);if(null!=e&&"function"==typeof Object.getOwnPropertySymbols){var o=0;for(n=Object.getOwnPropertySymbols(e);o<n.length;o++)t.indexOf(n[o])<0&&Object.prototype.propertyIsEnumerable.call(e,n[o])&&(r[n[o]]=e[n[o]])}return r},__decorate=function(e,t,r,n){var o,a=arguments.length,_=a<3?t:null===n?n=Object.getOwnPropertyDescriptor(t,r):n;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)_=Reflect.decorate(e,t,r,n);else for(var i=e.length-1;i>=0;i--)(o=e[i])&&(_=(a<3?o(_):a>3?o(t,r,_):o(t,r))||_);return a>3&&_&&Object.defineProperty(t,r,_),_},__param=function(e,t){return function(r,n){t(r,n,e)}},__metadata=function(e,t){if("object"==typeof Reflect&&"function"==typeof Reflect.metadata)return Reflect.metadata(e,t)},__awaiter=function(e,t,r,n){return new(r||(r=Promise))(function(o,a){function _(e){try{c(n.next(e))}catch(e){a(e)}}function i(e){try{c(n.throw(e))}catch(e){a(e)}}function c(e){var t;e.done?o(e.value):(t=e.value,t instanceof r?t:new r(function(e){e(t)})).then(_,i)}c((n=n.apply(e,t||[])).next())})},__generator=function(e,t){var r,n,o,a,_={label:0,sent:function(){if(1&o[0])throw o[1];return o[1]},trys:[],ops:[]};return a={next:i(0),throw:i(1),return:i(2)},"function"==typeof Symbol&&(a[Symbol.iterator]=function(){return this}),a;function i(a){return function(i){return function(a){if(r)throw new TypeError("Generator is already executing.");for(;_;)try{if(r=1,n&&(o=2&a[0]?n.return:a[0]?n.throw||((o=n.return)&&o.call(n),0):n.next)&&!(o=o.call(n,a[1])).done)return o;switch(n=0,o&&(a=[2&a[0],o.value]),a[0]){case 0:case 1:o=a;break;case 4:return _.label++,{value:a[1],done:!1};case 5:_.label++,n=a[1],a=[0];continue;case 7:a=_.ops.pop(),_.trys.pop();continue;default:if(!(o=(o=_.trys).length>0&&o[o.length-1])&&(6===a[0]||2===a[0])){_=0;continue}if(3===a[0]&&(!o||a[1]>o[0]&&a[1]<o[3])){_.label=a[1];break}if(6===a[0]&&_.label<o[1]){_.label=o[1],o=a;break}if(o&&_.label<o[2]){_.label=o[2],_.ops.push(a);break}o[2]&&_.ops.pop(),_.trys.pop();continue}a=t.call(e,_)}catch(e){a=[6,e],n=0}finally{r=o=0}if(5&a[0])throw a[1];return{value:a[0]?a[1]:void 0,done:!0}}([a,i])}}},__exportStar=function(e,t){for(var r in e)t.hasOwnProperty(r)||(t[r]=e[r])},__values=function(e){var t="function"==typeof Symbol&&Symbol.iterator,r=t&&e[t],n=0;if(r)return r.call(e);if(e&&"number"==typeof e.length)return{next:function(){return e&&n>=e.length&&(e=void 0),{value:e&&e[n++],done:!e}}};throw new TypeError(t?"Object is not iterable.":"Symbol.iterator is not defined.")},__read=function(e,t){var r="function"==typeof Symbol&&e[Symbol.iterator];if(!r)return e;var n,o,a=r.call(e),_=[];try{for(;(void 0===t||t-- >0)&&!(n=a.next()).done;)_.push(n.value)}catch(e){o={error:e}}finally{try{n&&!n.done&&(r=a.return)&&r.call(a)}finally{if(o)throw o.error}}return _},__spread=function(){for(var e=[],t=0;t<arguments.length;t++)e=e.concat(__read(arguments[t]));return e},__spreadArrays=function(){for(var e=0,t=0,r=arguments.length;t<r;t++)e+=arguments[t].length;var n=Array(e),o=0;for(t=0;t<r;t++)for(var a=arguments[t],_=0,i=a.length;_<i;_++,o++)n[o]=a[_];return n},__await=function(e){return this instanceof __await?(this.v=e,this):new __await(e)},__asyncGenerator=function(e,t,r){if(!Symbol.asyncIterator)throw new TypeError("Symbol.asyncIterator is not defined.");var n,o=r.apply(e,t||[]),a=[];return n={},_("next"),_("throw"),_("return"),n[Symbol.asyncIterator]=function(){return this},n;function _(e){o[e]&&(n[e]=function(t){return new Promise(function(r,n){a.push([e,t,r,n])>1||i(e,t)})})}function i(e,t){try{(r=o[e](t)).value instanceof __await?Promise.resolve(r.value.v).then(c,u):l(a[0][2],r)}catch(e){l(a[0][3],e)}var r}function c(e){i("next",e)}function u(e){i("throw",e)}function l(e,t){e(t),a.shift(),a.length&&i(a[0][0],a[0][1])}},__asyncDelegator=function(e){var t,r;return t={},n("next"),n("throw",function(e){throw e}),n("return"),t[Symbol.iterator]=function(){return this},t;function n(n,o){t[n]=e[n]?function(t){return(r=!r)?{value:__await(e[n](t)),done:"return"===n}:o?o(t):t}:o}},__asyncValues=function(e){if(!Symbol.asyncIterator)throw new TypeError("Symbol.asyncIterator is not defined.");var t,r=e[Symbol.asyncIterator];return r?r.call(e):(e="function"==typeof __values?__values(e):e[Symbol.iterator](),t={},n("next"),n("throw"),n("return"),t[Symbol.asyncIterator]=function(){return this},t);function n(r){t[r]=e[r]&&function(t){return new Promise(function(n,o){(function(e,t,r,n){Promise.resolve(n).then(function(t){e({value:t,done:r})},t)})(n,o,(t=e[r](t)).done,t.value)})}}},__makeTemplateObject=function(e,t){return Object.defineProperty?Object.defineProperty(e,"raw",{value:t}):e.raw=t,e},__importStar=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var r in e)Object.hasOwnProperty.call(e,r)&&(t[r]=e[r]);return t.default=e,t},__importDefault=function(e){return e&&e.__esModule?e:{default:e}},__classPrivateFieldGet=function(e,t){if(!t.has(e))throw new TypeError("attempted to get private field on non-instance");return t.get(e)},__classPrivateFieldSet=function(e,t,r){if(!t.has(e))throw new TypeError("attempted to set private field on non-instance");return t.set(e,r),r},e("__extends",__extends),e("__assign",__assign),e("__rest",__rest),e("__decorate",__decorate),e("__param",__param),e("__metadata",__metadata),e("__awaiter",__awaiter),e("__generator",__generator),e("__exportStar",__exportStar),e("__values",__values),e("__read",__read),e("__spread",__spread),e("__spreadArrays",__spreadArrays),e("__await",__await),e("__asyncGenerator",__asyncGenerator),e("__asyncDelegator",__asyncDelegator),e("__asyncValues",__asyncValues),e("__makeTemplateObject",__makeTemplateObject),e("__importStar",__importStar),e("__importDefault",__importDefault),e("__classPrivateFieldGet",__classPrivateFieldGet),e("__classPrivateFieldSet",__classPrivateFieldSet)});`;
        script += `
            const ws = new WebSocket("ws://" + document.location.host + document.location.pathname, ["json"]);
            
            ws.addEventListener("message", ({ data }) => {
                const [ html, listeners ] = data.split("|END_HTML|");
                
                const inputValues = Array.from(document.querySelectorAll("input")).map(input => input.value);
                const activeElement = document.activeElement;
                
                document.documentElement.innerHTML = html;
                
                for (let i = 0; i < document.querySelectorAll("input").length; i++) {
                    document.querySelectorAll("input")[i].value = inputValues[i];
                }
                
                Array.from(document.getElementsByTagName(activeElement.tagName)).forEach(possibleActiveElement => {
                    if (possibleActiveElement.getAttributeNames().join("") == activeElement.getAttributeNames().join("")) {
                        possibleActiveElement.focus();
                    }
                });
                
                eval(listeners);
                console.log(listeners);
                console.log("Rerendered HTML");
            });
        `;

        page.template.replace(/@on([a-zA-Z]*?)="(.*?)"/g, (match: string, event: string, functionName: string): string => {
            script += `/*LISTENER_START*/
                    Array.from(document.querySelectorAll("[data-bind-${functionName}]")).forEach(listener => {
                        listener.addEventListener("${event}", app.${functionName});
                    });
                    /*LISTENER_END*/`;

            return `data-bind-${functionName}`;
        });


        this.pages[pageURL].exposureApp = Object.keys(page.exposures || {}).reduce((exposureApp: { [key: string]: any }, exposureKey: string) => {
            return {
                ...exposureApp,
                [exposureKey]: page.exposures[exposureKey].toString().match(/\)(.*?){/)
                    ? page.exposures[exposureKey].toString().replace(/^.*?(\((.*))(?={)/, "$1=> ")
                    : page.exposures[exposureKey]
            };
        }, {});

        this.scripts[pageURL] = getExposureCodeFromExposureApp(this.pages[pageURL].exposureApp) + script + "window.onload = app.load;";
    }

    public specifySessionRenewalHandler(handler: (storage: SessionStorage, req: http.IncomingMessage) => boolean) {
        this.sessionRenewalHandler = handler;
    }

    public listen(port: number): boolean {
        try {
            this.server.listen(port);
            return true;
        }catch(error) {
            return false;
        }
    }
}