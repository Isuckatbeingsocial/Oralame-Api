(function oralameAPI() {
    class Traps { // this class will trap components of scratch such as the VM, RUNTIME, and SCRATCHBLOCKS.
        constructor(appElement) {
            this.app = appElement || document.querySelector("#app")
            this.vm = null;
            this.runtime = null;
            this.renderer = null;
            this.scratchBlocks = null;
            this.ioDevices = null;
            this.cloud = null;
            this.extensionMgr = null;
            this.sequencer = null;
            this.scratchGui = null;
            this.scratchPaint = null;
        }
        _trapBlocks() {
            var blocksWrapper = document.querySelector(
                'div[class^="gui_blocks-wrapper"]'
            );
            if (!blocksWrapper) {
                return null;
            }
            var key = Object.keys(blocksWrapper).find((key) =>
                key.startsWith("__reactInternalInstance$")
            );
            const internal = blocksWrapper[key];
            var recent = internal.child;
            while (!recent.stateNode?.ScratchBlocks) {
                recent = recent.child;
            }
            return recent.stateNode.ScratchBlocks || null;
        }
        trap() {
            this._reactKey = Object.keys(this.app).find(e => e.startsWith("__reactContainere$"));
            this.reactId = this._reactKey.split("$")[1];
            let scratchObject = this.app[this._reactKey].child.stateNode.store.getState();
            this.scratchGui = scratchObject.scratchGui;
            this.scratchPaint = scratchObject.scratchPaint;
            this.vm = scratchObject.scratchGui.vm;
            this.renderer = this.vm.runtime.renderer;
            this.runtime = this.vm.runtime;
            this.scratchBlocks = this._trapBlocks();
            this.ioDevices = this.runtime.ioDevices;
            this.cloud = this.ioDevices.cloud;
            this.extensionMgr = this.vm.extensionManager;
            this.sequencer = this.runtime.sequencer;
        }
        clear() {
            this.vm = null;
            this.runtime = null;
            this.renderer = null;
            this.scratchBlocks = null;
            this.ioDevices = null;
            this.cloud = null;
            this.extensionMgr = null;
            this.sequencer = null;
            this.scratchGui = null;
            this.scratchPaint = null;
        }
    }
    let globalTrapInstance = new Traps();
    class EngineHolder { // holds components of scratch.
        get vm() {
            return globalTrapInstance.vm;
        }
        get runtime() {
            return globalTrapInstance.runtime;
        }
        get blocks() {
            return globalTrapInstance.scratchBlocks;
        }
    }
    class ServiceUtility_HookDescriptor {
        new(before, after, bindOld, returnResult) {
            return new (this)(before, after, bindOld, returnResult)
        }
        constructor(before, after, bindOld, returnResult) {
            this.before = before;
            this.after = after;
            this.bindOld = bindOld;
            this.return = returnResult;
        }
    }
    
    class ServiceUtility {
        constructor() {
            this._natives = new WeakMap();
            this.HookDescriptor = ServiceUtility_HookDescriptor;

        }
    
        restoreNative(object, property) {
            if (this._natives.has(object) && this._natives.get(object)[property]) {
                object[property] = this._natives.get(object)[property];
            } else {
                throw new Error(`No native method found for ${property} on provided object.`);
            }
        }
    
        addNative(value, propertyName, object) {
            if (!this._natives.has(object)) {
                this._natives.set(object, {});
            }
            this._natives.get(object)[propertyName] = value;
        }
    
        hookMethod(object, property, method, descriptor) {
            if (typeof object[property] !== "function") {
                throw new TypeError(`Property '${property}' is not a function`);
            }
    
            if (!this._natives.has(object) || !this._natives.get(object)[property]) {
                this.addNative(object[property], property, object);
            }
    
            let old = object[property];
            if (descriptor.bindOld) {
                old = old.bind(object);
            }
    
            if (descriptor.before) {
                object[property] = function (...args) {
                    const result = method(...args);
                    if (descriptor.return) {
                        old.apply(this, args);
                        return result;
                    }
                    return old.apply(this, args);
                };
            } else if (descriptor.after) {
                object[property] = function (...args) {
                    const result1 = old.apply(this, args);
                    const result2 = method(...args);
                    return descriptor.return ? result2 : result1;
                };
            } else {
                throw new TypeError("Unexpected descriptor placement type, expected before or after.");
            }
        }
    }
    function throttle(func, wait) { // is outside of service utility as this wont be used just for services.
        let lastTime = 0;
        let timeout;
        let lastArgs;
        let lastThis;
    
        function invoke() {
            lastTime = Date.now();
            timeout = null;
            func.apply(lastThis, lastArgs);
        }
    
        return function (...args) {
            const now = Date.now();
            const remaining = wait - (now - lastTime);
            lastThis = this;
            lastArgs = args;
    
            if (remaining <= 0) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                invoke();
            } else if (!timeout) {
                timeout = setTimeout(invoke, remaining);
            }
        };
    }
    class CloudProvider {
        /**
         * A cloud data provider which creates and manages a web socket connection
         * to the Scratch cloud data server. This provider is responsible for
         * interfacing with the VM's cloud io device.
         * @param {string} cloudHost The url for the cloud data server
         * @param {VirtualMachine} vm The Scratch virtual machine to interface with
         * @param {string} username The username to associate cloud data updates with
         * @param {string} projectId The id associated with the project containing
         * cloud data.
         */
        constructor (cloudHost, vm, username, projectId, cloudService) {
            this.vm = vm;
            this.username = username;
            this.projectId = projectId;
            this.cloudHost = cloudHost;
    
            this.connectionAttempts = 0;
    
            // A queue of messages to send which were received before the
            // connection was ready
            this.queuedData = [];
    
            this.openConnection();
    
            // Send a message to the cloud server at a rate of no more
            // than 10 messages/sec.
            this.sendCloudData = throttle(this._sendCloudData, 1000 / cloudService.cloudMsgsPerSec);
        }
    
        /**
         * Open a new websocket connection to the clouddata server.
         * @param {string} cloudHost The cloud data server to connect to.
         */
        openConnection () {
            this.connectionAttempts += 1;
    
            try {
                this.connection = new WebSocket((location.protocol === 'http:' ? 'ws://' : 'wss://') + this.cloudHost);
            } catch (e) {
                console.warn('Websocket support is not available in this browser', e);
                this.connection = null;
                return;
            }
    
            this.connection.onerror = this.onError.bind(this);
            this.connection.onmessage = this.onMessage.bind(this);
            this.connection.onopen = this.onOpen.bind(this);
            this.connection.onclose = this.onClose.bind(this);
        }
    
        onError (event) {
            console.error(`Websocket connection error: ${JSON.stringify(event)}`);
            // Error is always followed by close, which handles reconnect logic.
        }
    
        onMessage (event) {
            const messageString = event.data;
            // Multiple commands can be received, newline separated
            messageString.split('\n').forEach(message => {
                if (message) { // .split can also contain '' in the array it returns
                    const parsedData = this.parseMessage(JSON.parse(message));
                    this.vm.postIOData('cloud', parsedData);
                }
            });
        }
    
        onOpen () {
            // Reset connection attempts to 1 to make sure any subsequent reconnects
            // use connectionAttempts=1 to calculate timeout
            this.connectionAttempts = 1;
            this.writeToServer('handshake');
            console.info(`Successfully connected to clouddata server.`);
    
            // Go through the queued data and send off messages that we weren't
            // ready to send before
            this.queuedData.forEach(data => {
                this.sendCloudData(data);
            });
            // Reset the queue
            this.queuedData = [];
        }
    
        onClose () {
            console.info(`Closed connection to websocket`);
            const randomizedTimeout = this.randomizeDuration(this.exponentialTimeout());
            this.setTimeout(this.openConnection.bind(this), randomizedTimeout);
        }
    
        exponentialTimeout () {
            return (Math.pow(2, Math.min(this.connectionAttempts, 5)) - 1) * 1000;
        }
    
        randomizeDuration (t) {
            return Math.random() * t;
        }
    
        setTimeout (fn, time) {
            console.info(`Reconnecting in ${(time / 1000).toFixed(1)}s, attempt ${this.connectionAttempts}`);
            this._connectionTimeout = window.setTimeout(fn, time);
        }
    
        parseMessage (message) {
            const varData = {};
            switch (message.method) {
            case 'set': {
                varData.varUpdate = {
                    name: message.name,
                    value: message.value
                };
                break;
            }
            }
            return varData;
        }
    
        /**
         * Format and send a message to the cloud data server.
         * @param {string} methodName The message method, indicating the action to perform.
         * @param {string} dataName The name of the cloud variable this message pertains to
         * @param {string | number} dataValue The value to set the cloud variable to
         * @param {string} dataNewName The new name for the cloud variable (if renaming)
         */
        writeToServer (methodName, dataName, dataValue, dataNewName) {
            const msg = {};
            msg.method = methodName;
            msg.user = this.username;
            msg.project_id = this.projectId;
    
            // Optional string params can use simple falsey undefined check
            if (dataName) msg.name = dataName;
            if (dataNewName) msg.new_name = dataNewName;
    
            // Optional number params need different undefined check
            if (typeof dataValue !== 'undefined' && dataValue !== null) msg.value = dataValue;
    
            const dataToWrite = JSON.stringify(msg);
            if (this.connection && this.connection.readyState === WebSocket.OPEN) {
                this.sendCloudData(dataToWrite);
            } else if (msg.method === 'create' || msg.method === 'delete' || msg.method === 'rename') {
                // Save data for sending when connection is open, iff the data
                // is a create, rename, or  delete
                this.queuedData.push(dataToWrite);
            }
    
        }
    
        /**
         * Send a formatted message to the cloud data server.
         * @param {string} data The formatted message to send.
         */
        _sendCloudData (data) {
            this.connection.send(`${data}\n`);
        }
    
        /**
         * Provides an API for the VM's cloud IO device to create
         * a new cloud variable on the server.
         * @param {string} name The name of the variable to create
         * @param {string | number} value The value of the new cloud variable.
         */
        createVariable (name, value) {
            this.writeToServer('create', name, value);
        }
    
        /**
         * Provides an API for the VM's cloud IO device to update
         * a cloud variable on the server.
         * @param {string} name The name of the variable to update
         * @param {string | number} value The new value for the variable
         */
        updateVariable (name, value) {
            this.writeToServer('set', name, value);
        }
    
        /**
         * Provides an API for the VM's cloud IO device to rename
         * a cloud variable on the server.
         * @param {string} oldName The old name of the variable to rename
         * @param {string} newName The new name for the cloud variable.
         */
        renameVariable (oldName, newName) {
            this.writeToServer('rename', oldName, null, newName);
        }
    
        /**
         * Provides an API for the VM's cloud IO device to delete
         * a cloud variable on the server.
         * @param {string} name The name of the variable to delete
         */
        deleteVariable (name) {
            this.writeToServer('delete', name);
        }
    
        /**
         * Closes the connection to the web socket and clears the cloud
         * provider of references related to the cloud data project.
         * Overriden by oralameAPI
         */
        requestCloseConnection () {}
    
        /**
         * Clear this provider of references related to the project
         * and current state.
         * Overriden by oralameAPI
         */
        clear () {}
    
    }
    
    const util = new ServiceUtility();
    const services = {}; // holds all api services.
    function registerService(name, service) {
        services[name] = service;
    }
    function getInternalService(name) {
        return services[name] || (services[name] = {});
    }
    class CloudService {
        constructor() {
            this.MessageType = {
                INGOING: "ingoing",
                OUTGOING: "outgoing"
            };
            this.message_hooks_ingoing = [];
            this.message_hooks_outgoing = [];
            const onMessage = this.onMessage;
            if (!globalTrapInstance.cloud) {
                globalTrapInstance.trap();
            }
            if (!globalTrapInstance.cloud || !globalTrapInstance.provider) {
                console.warn("Cloud is not set up correctly in this environment.");
                return this;
            }
            globalTrapInstance.cloud.provider.openConnection = function() {
                this.connectionAttempts += 1;
                try {
                    if (!this.cloudHost || (!this.cloudHost.includes('ws://') && !this.cloudHost.includes('wss://'))) {
                        this.cloudHost = (location.protocol === 'http:' ? 'ws://' : 'wss://') + this.cloudHost;
                    }
                    this.connection = new WebSocket(this.cloudHost);
                } catch (e) {
                    console.warn('Websocket support is not available in this browser', e);
                    this.connection = null;
                    return;
                }
        
                this.connection.onerror = this.onError.bind(this);
                this.connection.onmessage = this.onMessage.bind(this);
                this.connection.onopen = this.onOpen.bind(this);
                this.connection.onclose = this.onClose.bind(this);
                util.hookMethod(this, "_sendCloudData", (data) => {
                    for (let hook of this.message_hooks_outgoing) { 
                        if (hook.type && hook.type === data.method) {
                            hook.method(data);
                        } else {
                            hook.method(data); 
                        }
                    }
                }, descriptor);
                util.hookMethod(this.connection, "onmessage", (event) => {
                    this.onMessage(event);
                }, new (util.HookDescriptor)(true, false, false, false));
            }
            this.cloudMsgsPerSec = 10;
            this.init();
        }
        setCloudMsgsPerSec(value) {
            this.cloudMsgsPerSec = value;
            const cloud = globalTrapInstance.cloud;
            cloud.provider.sendCloudData = throttle(cloud.provider._sendCloudData, 1000 / this.cloudMsgsPerSec);
        }
        init() {
            const cloud = globalTrapInstance.cloud;
            cloud.clear = () => {};
            const descriptor = new (util.HookDescriptor)(true, false, true, false);
            util.hookMethod(cloud.provider, "_sendCloudData", (data) => {
                for (let hook of this.message_hooks_outgoing) { 
                    if (hook.type && hook.type === data.method) {
                        hook.method(data);
                    } else {
                        hook.method(data); 
                    }
                }
            }, descriptor);
            util.hookMethod(cloud.provider.connection, "onmessage", (event) => {
                this.onMessage(event);
            }, new (util.HookDescriptor)(true, false, false, false));


        }
        onMessage(event) {
            const messageString = event.data;
            let messages = [];
            messageString.split('\n').forEach(message => {
                const messageData = JSON.parse(message);
                for (let hook of this.message_hooks_ingoing) {
                    if (hook.type && hook.type == messageData.method) {
                        hook.method(messageData);
                    } else {
                        hook.method(messageData);
                    }
                }
                messages.push(JSON.stringify(messageData));
            });
            Object.defineProperty(event, "data", {
                get() {
                    return messages.join('\n');
                }
            })
        }
        addCloudListener(messageType, method) {
            let hooks;
            if (messageType === this.MessageType.INGOING) {
                hooks = this.message_hooks_ingoing;
            } else {
                hooks = this.message_hooks_outgoing;
            }
        
            const hook = { method };
            hooks.push(hook);
        
            return () => {
                const index = hooks.indexOf(hook);
                if (index !== -1) hooks.splice(index, 1);
            };
        }
        
        onCloudEvent(messageType, type, method) {
            let hooks;
            if (messageType === this.MessageType.INGOING) {
                hooks = this.message_hooks_ingoing;
            } else {
                hooks = this.message_hooks_outgoing;
            }
        
            const hook = { type, method };
            hooks.push(hook);
        
            return () => {
                const index = hooks.indexOf(hook);
                if (index !== -1) hooks.splice(index, 1);
            };
        }   
        findProjectId() {
            let string = location.href.split('/');
            for (let i = 0; i < string.length; i++) {
                let item = string[i];
                if (parseInt(item)) {
                    return item;
                }
            }
        }   
        cloudVarName(varName) {
            return `☁ ${varName}`;
        }
        noCloudDisable() {
            const cloud = globalTrapInstance.cloud;
            cloud.clear = () => {};
            cloud.provider = new CloudProvider(location.href.includes("turbowarp") ? "clouddata.turbowarp.org/" : "clouddata.scratch.mit.edu/", globalTrapInstance.vm, globalTrapInstance.ioDevices.userData._username, this.findProjectId(), this);
            const onMessage = this.onMessage;
            if (!globalTrapInstance.cloud) {
                globalTrapInstance.trap();
            }
            globalTrapInstance.cloud.provider.openConnection = function() {
                this.connectionAttempts += 1;
                try {
                    if (!this.cloudHost || (!this.cloudHost.includes('ws://') && !this.cloudHost.includes('wss://'))) {
                        this.cloudHost = (location.protocol === 'http:' ? 'ws://' : 'wss://') + this.cloudHost;
                    }
                    this.connection = new WebSocket(this.cloudHost);
                } catch (e) {
                    console.warn('Websocket support is not available in this browser', e);
                    this.connection = null;
                    return;
                }
        
                this.connection.onerror = this.onError.bind(this);
                this.connection.onmessage = this.onMessage.bind(this);
                this.connection.onopen = this.onOpen.bind(this);
                this.connection.onclose = this.onClose.bind(this);
                util.hookMethod(this, "_sendCloudData", (data) => {
                    for (let hook of this.message_hooks_outgoing) { 
                        if (hook.type && hook.type === data.method) {
                            hook.method(data);
                        } else {
                            hook.method(data); 
                        }
                    }
                }, descriptor);
                util.hookMethod(this.connection, "onmessage", (event) => {
                    this.onMessage(event);
                }, new (util.HookDescriptor)(true, false, false, false));
            }
        }  
    }
    class SpriteService {
        constructor() {
            this.maxClones = globalTrapInstance.runtime.constructor.MAX_CLONES;
            globalTrapInstance.runtime.clonesAvailable = () => this.cloneCount < this.maxClones;
        }
        static get clones() {
            return globalTrapInstance.runtime.targets.filter(e => !e.isOriginal);       
        }
        static get cloneCount() {
            return (globalTrapInstance.runtime.targets.filter(e => !e.isOriginal)).length;
        }
        static get sprites() {
            return globalTrapInstance.runtime.targets.filter(e => e.isOriginal);
        }
        static get spriteLength() {
            return (globalTrapInstance.runtime.targets.filter(e => e.isOriginal)).length;
        }
        getSpriteByName(name) {
            return globalTrapInstance.runtime.targets.find(e => e.name == name);
        }
        getSpriteById(id) {
            return globalTrapInstance.runtime.targets.find(e => e.id == id);
        }
        cloneSprite(sprite) {
            const clone = sprite.makeClone()
            clone.goBehindOther(sprite);
            globalTrapInstance.runtime.addTarget(sprite);
        }
        clearCloneBySprite(sprite) {
            for (let clone of sprite.sprite.clones) {
                globalTrapInstance.runtime.disposeTarget(clone);
            }
        }
        clearAllClones() {
            for (let clone of this.clones) {
                globalTrapInstance.runtime.disposeTarget(clone);
            }
        }
    }
    class VariableService {
        constructor() {

        }
        makeVariableNotCloud(variable) {
            variable.isCloud = false;
        }
        setVariableById(id, value, target) {
            const cloud = globalTrapInstance.cloud;
            let variable = this.getVariableById(id, target || false);
            variable.value = value;
            if (cloud && variable.isCloud) {
                cloud.provider.updateVariable(variable.name, variable.value);
            }
        }

        getVariableByName(name, target) {
            if (target) {
                const variable = Object.values(target.variables).find(variable => variable.name === name);
                return variable || false;
            } else {
                for (let target of globalTrapInstance.runtime.targets) {
                    const variable = Object.values(target.variables).find(variable => variable.name === name);
                    if (variable) {
                        return variable;
                    }
                }
                return false;
            }
        }
        
        getVariableById(id, target) {
            if (target) {
                if (target.variables[id]) {
                    return target.variables[id];
                } else {
                    return false;
                }
            } else {
                for (let target of globalTrapInstance.runtime.targets) {
                    if (target.variables[id]) {
                        return target.variables[id];
                    }
                }
                return false;
            }
        }
        getVariableId(variable) {
            return variable.id; // this wont ever change unless the variable is deleted and remade.
        }
        makeVariableCloud(variable) {
            variable.isCloud = true
        }
    }
    class DisablerService {
        constructor() {
            this.customBypasses = {};
        }
        bypass(AcName) {
            this.customBypasses[AcName](globalTrapInstance.vm);
        }
        bypassUniversal() { // this bypass works for some basic platformer acs. Acs with mitigation or punishments may not be affected if they do these out of the flag block. Obfuscated ACS will not be affected.
            const t = globalTrapInstance.runtime.targets
            for (let i = 0; i < t.length; i++) {
                const target = t[i];
                for (let blockId in target.blocks._blocks) {
                    const block = target.blocks._blocks[blockId];
                    if (block.opcode == "procedures_prototype") {
                        const mutation = block.mutation;
                        if (mutation.proccode.toLowerCase().includes("flag") || mutation.proccode.toLowerCase().includes('alert')) {
                            const definition = target.blocks._blocks[block.parent];
                            definition.next = null; // disconnect blocks under it
                        }
                    }
                }
                target.blocks.resetCache()
            }
        }
    }
    class BlockService_Block {
        static blocks = [];
    
        constructor(vmBlock, parentSprite) {
            BlockService_Block.blocks.push(this);
            this.vmBlock = vmBlock;
            this.vmBlocks = parentSprite.blocks;
            this.parentSprite = parentSprite;
            this.blockType = null;
            this.blockOpcode = null;
            this.x = null;
            this.y = null;
            this.next = null;
            this.parent = null;
            this.id = null;
            this.inputs = {};
            this.fields = {};
            this.prevVmState = vmBlock;
            this.translate();
        }
    
        translate() {
            // Using this.vmBlock directly
            const vmBlock = this.vmBlock;
            const block0 = this;
            this.id = this.vmBlock?.id || null;
            this.blockOpcode = this.vmBlock?.opcode || null;
            this.x = this.vmBlock?.x !== undefined ? parseFloat(this.vmBlock?.x) : null;
            this.y = this.vmBlock?.y !== undefined ? parseFloat(this.vmBlock?.y) : null;
            this.next = this.vmBlock?.next || null;
            this.parent = this.vmBlock?.parent || null;
    
            this.nextBlock = this.vmBlock?.next ? new BlockService_Block(this.vmBlocks[this.vmBlock.next], this.parentSprite) : null;
            this.parentBlock = this.vmBlock?.parent ? new BlockService_Block(this.vmBlocks[this.vmBlock.parent], this.parentSprite) : null;
    
            if (this.vmBlock?.fields) {
                for (const fieldName in this.vmBlock.fields) {
                    const field = this.vmBlock.fields[fieldName];
                    this.fields[fieldName] = { id: field.id || null, value: field.value || null };
                }
            }
    
            if (this.vmBlock?.inputs) {
                for (const inputName in this.vmBlock.inputs) {
                    const input = this.vmBlock.inputs[inputName];
                    this.inputs[inputName] = {
                        name: input.name || null,
                        block: input.block && this.vmBlocks._blocks[input.block] 
                            ? new BlockService_Block(this.vmBlocks._blocks[input.block], this.parentSprite) 
                            : null
                    };
                }
            }
    
            if (this.vmBlock?.mutation) {
                this.mutation = {};
                Object.defineProperties(this.mutation, {
                    blockLabels: {
                        get: () => this.vmBlock.mutation.proccode.split(/%s|%b/),
                    },
                    blockProccode: {
                        get: () => this.parseBlockProccode(this.vmBlock.mutation.proccode),
                    },
                    argumentIds: {
                        get: () => JSON.parse(this.vmBlock.mutation.argumentids),
                    },
                    argumentNames: {
                        get: () => JSON.parse(this.vmBlock.mutation.argumentnames),
                    }
                });
                this.mutation.deleteArgument = function(argName) {
                    const argumentNames = this.argumentNames;
                    const argumentIds = this.argumentIds;
                    let idx = (argumentNames.findIndex(name => name == argName)) + 1; // block proccode stuff is one indexed.
                    argumentNames.splice(idx - 1, 1);
                    argumentIds.splice(idx - 1, 1);
                    const blockProccode = this.blockProccode
                    blockProccode.splice(idx, 1);
                    vmBlock.mutation.proccode = blockProccode.join('');
                    vmBlock.mutation.argumentids = JSON.stringify(argumentIds);
                    vmBlock.mutation.argumentNames = JSON.stringify(argumentNames);
                }
            }
        }
    
        parseBlockProccode(str) {
            return str.split(/(%s|%b)/).filter(Boolean);
        }
    
        disconnectPrevious() {
            this.parent = null;
            this.parentBlock = null;
        }
    
        disconnectNext() {
            this.next = null;
            this.nextBlock = null;
        }
    
        changesToVm() {
            this.vmBlock.opcode = this.blockOpcode;
            this.vmBlock.x = this.x;
            this.vmBlock.y = this.y;
            this.vmBlock.next = this.next || null;
            this.vmBlock.parent = this.parent || null;
    
            if (this.fields) {
                this.vmBlock.fields = {};
                for (const fieldName in this.fields) {
                    this.vmBlock.fields[fieldName] = {
                        name: fieldName,
                        id: this.fields[fieldName].id,
                        value: this.fields[fieldName].value
                    };
                }
            }
    
            if (this.inputs) {
                this.vmBlock.inputs = {};
                for (const inputName in this.inputs) {
                    const inputBlock = this.inputs[inputName].block;
                    if (inputBlock) {
                        inputBlock.changesToVm();
                        this.vmBlock.inputs[inputName] = { name: this.inputs[inputName].name, block: inputBlock.id, shadow: inputBlock.id };
                    } else {
                        this.vmBlock.inputs[inputName] = null;
                    }
                }
            }
        }
    
        updateSpriteWorkspace() {
            this.vmBlocks.resetCache();
        }
    
        updateBlock(type) {
            if (type === "incoming") {
                this.changesToVm();
                this.updateSpriteWorkspace();
            } else if (type === "outgoing") {
                this.translate();
            }
        }
    
        setInput(name, input_type, value) {
            if (this.inputs[name]?.block) {
                const result = this.inputs[name].block.setField(input_type.toUpperCase(), value);
                this.updateBlock("incoming");
                return result;
            }
            return false;
        }
        getInput(name, input_type) {
            if (this.inputs[name]?.block) {
                const result = this.inputs[name].block.getField(input_type.toUpperCase());
                return result;
            }
            return false;    
        }
        setField(name, value) {
            if (this.fields[name]) {
                this.fields[name].value = value;
                this.updateBlock("incoming");
                return value;
            }
            return false;
        }
        getField(name, value) {
            return this.fields[name] ? this.fields[name].value : false;
        }
        setParent(blockId) {
            if (this.parent) {
                this.parentBlock.setNext(null);
            }
            this.parent = blockId;
            this.parentBlock = this.vmBlocks[blockId];
            if (!this.parentBlock && blockId !== null) {
                throw new Error("Invalid block id.");
            }
        }
        setNext(blockId) {
            if (this.next) {
                this.nextBlock.setParent(null);
            }
            this.next = blockId;
            this.nextBlock = this.vmBlocks[blockId];
            if (!this.nextBlock && blockId !== null) {
                throw new Error("Invalid block id.");
            }
        }
        dispose() {
            this.parentBlock.setNext(null);
            this.nextBlock.setParent(null);
            this.disconnectNext();
            this.disconnectPrevious();
            this.updateBlock("incoming");
        }
    }
    class BlockService {
        constructor() {

        }
        get blocks() {
            return BlockService_Block.blocks
        }
        translateScript(scriptId, target) {
            const block = BlockService_Block(target.blocks._blocks[scriptId], target);
            return block;
        }
        deleteBlock(blockId) {
            const block = this.blocks.find(block => block.id == blockId) 
            if (block) { block.dispose() } else {
                throw new Error("This block does not exist or has not been translated by the block service.")
            }
        }
    }
    class Emitter {
        constructor() {
            this._events = {};
        }
        add(eventName) {
            if (!this._events[eventName]) {
                this._events[eventName] = [];
            }
        }
        on(eventName, handler) {
            if (!this._events[eventName]) {
                this.add(eventName); 
            }
            this._events[eventName].push(handler);
        }
        eventNames() {
            return Object.keys(this._events);
        }
        emit(eventName, ...args) {
            const event = this._events[eventName];
            if (event) {
                for (let handler of event) {
                    handler(...args);
                }
            } else {
                console.warn(`Event "${eventName}" does not exist.`);
            }
        }
    }
    class Input {
        constructor(type, data) {
            this.type = type;
            this.data = data;
        }
    }
    class InputService extends Emitter {
        constructor() {
            super();
            this.add("InputBegun");
            this.add("InputEnded");
    
            document.addEventListener("keydown", (event) => {
                this.emit("InputBegun", new Input("keyboard", { key: event.key }));
            });
    
            document.addEventListener("keyup", (event) => {
                this.emit("InputEnded", new Input("keyboard", { key: event.key }));
            });
    
            document.addEventListener("click", (event) => {
                this.emit("InputBegun", new Input("m1Down", {}));
            });
    
            document.addEventListener("mouseup", (event) => {
                this.emit("InputEnded", new Input("m1Up", {}));
            });
        }
        inputBegan(handler) {
            this.on("InputBegun", handler);
        }
        inputEnded(handler) {
            this.on("InputEnded", handler);
        }
        isMouseButton1Down() {
            return globalTrapInstance.ioDevices.mouse.getIsDown();
        }
    
        isKeyDown(key) {
            return globalTrapInstance.ioDevices.keyboard.getKeyIsDown(key);
        }
        simMouse(isDown, x, y) {
            globalTrapInstance.ioDevices.mouse.postData({isDown, x, y});
        }
        simKeyboard(key, isDown) {
            globalTrapInstance.ioDevices.keyboard.postData({key, isDown});
        }
    }
    class UserDataService {
        get username() {
            return globalTrapInstance.ioDevices.userData._username;
        }
        set username(value) {
            globalTrapInstance.ioDevices.userData.postData({ username: value });
        }
    }
    class MainApi {
        constructor() {
            this.state = "activated";
            const engine = new EngineHolder();
            Object.defineProperty(this, "engine", {
                get() {
                    return engine;
                }
            });
            this.cloud = this.getService("CloudService");
            this.sprites = this.getService("SpriteService");
            this.variables = this.getService("VariableService");
            this.disabler = this.getService("DisablerService");
            this.blocks = this.getService("BlockService");
        }
        getService(serviceName) {
            return getInternalService(serviceName)
        }
        isActivated() {
            return true;
        }
    }
    class GlobalApi {
        constructor() {
            this._activeApis = [];
            this._trapsHasBeenInitilized = true;
            globalTrapInstance.trap();
        }
        _registerDefaultServices() {
            registerService("CloudService", new CloudService());
            registerService("SpriteService", new CloudService());
            registerService("VariableService", new CloudService());
            registerService("DisablerService", new CloudService());
            registerService("BlockService", new BlockService());
            registerService("InputService", new InputService());
            registerService("UserDataService", new UserDataService());
        }
        start() {
            this._registerDefaultServices();
            let inst = new MainApi();
            this._activeApis.push(inst);
            return inst;
        }
        stop(inst) {
            if (inst instanceof MainApi) {
                this._activeApis = this._activeApis.filter(e => e !== inst);
                for (let key in inst) {
                    delete inst[key];
                }
                inst.state = "deactivated";
                inst.isActivated = () => false;
            } else {
                return;
            }
        }
    }
    window.api = new GlobalApi();
})();