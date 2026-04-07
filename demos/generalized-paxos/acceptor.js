// Generalized Paxos — Acceptor / Register Set

class Active extends State {
    getState() { return ['Active', '#cfd8dc']; }

    registerMessageTypes() {
        return {
            'P1A': (msg) => {
                const { regIndex } = msg.payload;

                // Rule 1: Set all lower registers to 'nil' to prevent older writes
                for (let i = 0; i < regIndex; i++) {
                    if (this.machine.registers[i] === 'unwritten') {
                        this.machine.registers[i] = 'nil';
                    }
                }

                sendMessage(msg.from, {
                    type: 'P1B',
                    registers: [...this.machine.registers]
                }, 'green');

                this.machine.syncUI();
            },
            'P2A': (msg) => {
                const { regIndex, val } = msg.payload;

                // Rule 2: Only write if the register is completely unwritten
                if (this.machine.registers[regIndex] === 'unwritten') {
                    this.machine.registers[regIndex] = val;
                    sendMessage(msg.from, { type: 'P2B_OK' }, 'blue');
                } else {
                    sendMessage(msg.from, { type: 'P2B_NACK' }, 'red');
                }

                this.machine.syncUI();
            }
        };
    }
}

class AcceptorMachine extends Machine {
    constructor() {
        super();
        // 5 abstract registers initialized as unwritten
        this.registers = ['unwritten', 'unwritten', 'unwritten', 'unwritten', 'unwritten'];
        this.states = [new Active()];
        this.syncUI();
    }

    // Expose data to render.js
    syncUI() {
        this.ui_registers = [...this.registers];
    }
}

const MACHINE = new AcceptorMachine();
function onUp() { MACHINE.onUp(); }
function onTimer(t) { MACHINE.onTimer(t); }
function onMessage(m) { MACHINE.onMessage(m); }