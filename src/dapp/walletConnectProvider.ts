import WalletClient from "@walletconnect/client";
import { IProvider } from "../interface";
import { Transaction } from "../transaction";
import { Address } from "../address";
import { IDappProvider } from "./interface";
import { Signature } from "../signature";

export class WalletConnectProvider extends EventTarget implements IDappProvider {
    provider: IProvider;
    walletConnectBridge: string;
    address: string = "";
    walletConnector: WalletClient | undefined;
    private onWalletConnectLogin: Event = new Event("onWalletConnectLogin");
    private onWalletConnectDisconect: Event = new Event("onWalletConnectDisconect");
    constructor(httpProvider: IProvider, walletConnectBridge: string = "") {
        super();
        this.provider = httpProvider;
        this.walletConnectBridge = walletConnectBridge;
    }

    /**
     * Initiates wallet connect client.
     */
    async init(): Promise<boolean> {
        this.walletConnector = new WalletClient({
            bridge: this.walletConnectBridge,
        });
        this.walletConnector.on("connect", this.onConnect);
        this.walletConnector.on("session_update", this.onDisconnect);
        this.walletConnector.on("disconnect", this.onDisconnect);
        return true;
    }

    /**
     * Returns true if init() was previously called successfully
     */
    isInitialized(): boolean {
        return !!this.walletConnector;
    }

    /**
     * Mocked function, returns isInitialized as an async function
     */
    isConnected(): Promise<boolean> {
        return new Promise((resolve, _) => resolve(this.isInitialized()));
    }

    /**
     *
     */
    async login(): Promise<string> {
        const chainId = 508;
        let returnUrl = "";
        if (!this.walletConnector) {
            await this.init();
        }
        if (this.walletConnector?.connected) {
            this.walletConnector.killSession();
        } else {
            await this.walletConnector?.createSession({ chainId }).then(() => {
                const uri = this.walletConnector?.uri;
                if (uri !== undefined) {
                    returnUrl = uri;
                }
            });
        }
        return returnUrl;
    }

    loginAccount = (address: string) => {
        if (this.addressIsValid(address)) {
            this.address = address;
            this.dispatchEvent(this.onWalletConnectLogin);
        } else {
            if (this.walletConnector?.connected) {
                this.walletConnector?.killSession();
            }
        }
    };

    onConnect = async (error: any, { params }: any) => {
        if (error) {
            throw error;
        }
        if (!params || !params[0]) {
            throw new Error("missing payload");
        }
        const {
            accounts: [account],
        } = params[0];

        this.loginAccount(account);
    };

    onDisconnect = async (error: any) => {
        if (error) {
            throw error;
        }

        this.dispatchEvent(this.onWalletConnectDisconect);
    };

    /**
     * Mocks a logout request by returning true
     */
    async logout(): Promise<boolean> {
        if (!this.walletConnector) {
            throw new Error("Wallet Connect not initialised, call init() first");
        }
        this.walletConnector.killSession();
        return true;
    }

    /**
     * Fetches current selected ledger address
     */
    async getAddress(): Promise<string> {
        return this.address;
    }

    /**
     * Signs and sends a transaction. Returns the transaction hash
     * @param transaction
     */
    async sendTransaction(transaction: Transaction): Promise<Transaction> {
        if (!this.walletConnector) {
            throw new Error("Wallet Connect not initialised, call init() first");
        }

        const address = await this.getAddress();
        const sig = await this.signTransaction("erd_sign", this.prepareWalletConnectMessage(transaction, address));
        if (sig && sig.signature) transaction.applySignature(new Signature(sig.signature), new Address(address));

        await transaction.send(this.provider);

        return transaction;
    }

    private async signTransaction(method: any, params: any): Promise<any> {
        if (!this.walletConnector) {
            throw new Error("Wallet Connect not initialised, call init() first");
        }
        if (this.walletConnector.connected) {
            const response = await this.walletConnector.sendCustomRequest({
                method,
                params,
            });

            return response;
        } else {
            return false;
        }
    }

    private prepareWalletConnectMessage(transaction: Transaction, address: string): any {
        return {
            nonce: transaction.getNonce().valueOf(),
            from: address,
            to: transaction.getReceiver().toString(),
            amount: transaction.getValue().toString(),
            gasPrice: transaction
                .getGasPrice()
                .valueOf()
                .toString(),
            gasLimit: transaction
                .getGasLimit()
                .valueOf()
                .toString(),
            data: Buffer.from(
                transaction
                    .getData()
                    .toString()
                    .trim()
            ).toString(),
            chainId: transaction.getChainID().valueOf(),
            version: transaction.getVersion().valueOf(),
        };
    }

    private canTransformToPublicKey(address: string): boolean {
        try {
            const checkAddress = new Address(address);
            return Boolean(checkAddress.bech32());
        } catch {
            return false;
        }
    }

    private addressIsValid(destinationAddress: string): boolean {
        const isValidBach = !(
            !destinationAddress ||
            !destinationAddress.startsWith("erd") ||
            destinationAddress.length !== 62 ||
            /^\w+$/.test(destinationAddress) !== true
        );
        return isValidBach && this.canTransformToPublicKey(destinationAddress);
    }
}