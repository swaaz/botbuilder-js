/**
 * @module botbuilder-dialogs
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { TurnContext, BotState, ConversationState, UserState, ActivityTypes, TurnContextStateCollection } from 'botbuilder-core';
import { DialogContext, DialogState } from './dialogContext';
import { DialogTurnResult, Dialog, DialogTurnStatus } from './dialog';
import { Configurable } from './configurable';
import { DialogSet } from './dialogSet';
import { DialogStateManagerConfiguration, DialogStateManager, TurnPath } from './memory';
import { DialogEvents } from './dialogEvents';
import { DialogTurnStateConstants } from './dialogTurnStateConstants';

const LAST_ACCESS: string = '_lastAccess';
const DIALOGS: string = '_dialogs';

export interface DialogManagerResult {
    turnResult: DialogTurnResult;
}

export interface DialogManagerConfiguration {
    /**
     * State property used to persist the bots dialog stack.
     */
    conversationState: BotState;

    /**
     * Root dialog to start from [onTurn()](#onturn) method.
     */
    rootDialog: Dialog;

    /**
     * Optional. Bots persisted user state.
     */
    userState?: UserState;

    /**
     * Optional. Number of milliseconds to expire the bots conversation state after.
     */
    expireAfter?: number;

    /**
     * Optional. Path resolvers and memory scopes used for conversations with the bot.
     */
    stateConfiguration?: DialogStateManagerConfiguration;
}

export class DialogManager extends Configurable {
    private dialogSet: DialogSet = new DialogSet();
    private rootDialogId: string;
    private readonly _initialTurnState: TurnContextStateCollection = new TurnContextStateCollection();

    constructor(config?: DialogManagerConfiguration) {
        super();
        if (config) { this.configure(config) }
        this._initialTurnState.set(DialogTurnStateConstants.dialogManager, this);
    }

    /**
     * Values that will be copied to the `TurnContext.turnState` at the beginning of each turn.
     */
    public get initialTurnState(): TurnContextStateCollection {
        return this._initialTurnState;
    }

    /**
     * Bots persisted conversation state.
     */
    public conversationState: ConversationState;

    /**
     * Root dialog to start from [onTurn()](#onturn) method.
     */
    public set rootDialog(dialog: Dialog) {
        this.dialogSet.add(dialog);
        this.rootDialogId = dialog.id;
    }

    public get rootDialog(): Dialog {
        return this.rootDialogId ? this.dialogSet.find(this.rootDialogId) : undefined;
    }

    /**
     * Optional. Bots persisted user state.
     */
    public userState?: UserState;

    /**
     * Optional. Number of milliseconds to expire the bots conversation state after.
     */
    public expireAfter?: number;

    /**
     * Optional. Path resolvers and memory scopes used for conversations with the bot.
     */
    public stateConfiguration?: DialogStateManagerConfiguration;

    public configure(config: Partial<DialogManagerConfiguration>): this {
        return super.configure(config);
    }

    public async onTurn(context: TurnContext): Promise<DialogManagerResult> {
        // Ensure properly configured
        if (!this.rootDialogId) { throw new Error(`DialogManager.onTurn: the bots 'rootDialog' has not been configured.`) }
        if (!this.conversationState) { throw new Error(`DialogManager.onTurn: the bots 'conversationState' has not been configured.`) }

        // Copy initial turn state to context
        for (const key in this.initialTurnState.keys()) {
            context.turnState.set(key, this.initialTurnState.get(key));
        }

        // Get last access
        const lastAccessProperty = this.conversationState.createProperty(LAST_ACCESS);
        const lastAccess = new Date(await lastAccessProperty.get(context, new Date().toISOString()));

        // Check for expired conversation
        const now = new Date();
        if (this.expireAfter != undefined && (now.getTime() - lastAccess.getTime()) >= this.expireAfter) {
            // Clear conversation state
            await this.conversationState.clear(context);
        }

        // Update last access time
        await lastAccessProperty.set(context, lastAccess.toISOString());

        // get dialog stack 
        const dialogsProperty = this.conversationState.createProperty(DIALOGS);
        const dialogState: DialogState = await dialogsProperty.get(context, {});

        // Create DialogContext
        const dc = new DialogContext(this.dialogSet, context, dialogState);
        dc.state.setValue(TurnPath.activity, context.activity);

        // Configure dialog state manager and load scopes
        const config = this.stateConfiguration ? this.stateConfiguration : DialogStateManager.createStandardConfiguration(this.conversationState, this.userState);
        dc.state.configuration = config;
        await dc.state.loadAllScopes();

        let turnResult: DialogTurnResult;
        while (true) {
            try {
                if (dc.activeDialog) {
                    // Continue dialog execution
                    // - This will apply any queued up interruptions and execute the current/next step(s).
                    turnResult = await dc.continueDialog();
                    if (turnResult.status == DialogTurnStatus.empty) {
                        // Begin root dialog
                        turnResult = await dc.beginDialog(this.rootDialogId);
                    }
                } else {
                    turnResult = await dc.beginDialog(this.rootDialogId);
                }
                break;
            } catch (err) {
                const handled = await dc.emitEvent(DialogEvents.error, err, true, true);
                if (!handled) {
                    throw err;
                }
            }
        }

        // Save any memory changes
        await dc.state.saveAllChanges();

        // Send trace of memory to emulator
        const snapshot: object = dc.state.getMemorySnapshot();
        await dc.context.sendActivity({
            type: ActivityTypes.Trace,
            name: 'BotState',
            valueType: 'https://www.botframework.com/schemas/botState',
            value: snapshot,
            label: 'Bot State'
        });

        return { turnResult: turnResult };
    }
}