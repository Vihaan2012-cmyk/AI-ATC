// AI ATC toolbar panel. When the panel opens, point the iframe at the widget served by
// the brain (npm run server) at http://localhost:8742/. That page connects same-origin
// over WebSocket. Change the port here if you set WS_PORT to something else.
const AIATC_URL = 'http://localhost:8742/';

class IngamePanelAIATC extends TemplateElement {
    constructor() {
        super(...arguments);
        this.panelActive = false;
        this.started = false;
        this.ingameUi = null;
        this.iframeElement = null;
        this.initialize();
    }

    connectedCallback() {
        super.connectedCallback();
        const self = this;
        this.ingameUi = this.querySelector('ingame-ui');
        this.iframeElement = document.getElementById('AIATCIframe');

        if (this.ingameUi) {
            this.ingameUi.addEventListener('panelActive', () => {
                self.panelActive = true;
                if (self.iframeElement) self.iframeElement.src = AIATC_URL;
            });
            this.ingameUi.addEventListener('panelInactive', () => {
                self.panelActive = false;
                if (self.iframeElement) self.iframeElement.src = '';
            });
        }
    }

    initialize() {
        if (this.started) return;
        this.started = true;
    }

    disconnectedCallback() {
        super.disconnectedCallback();
    }
}

window.customElements.define('ingamepanel-aiatc', IngamePanelAIATC);
checkAutoload();
