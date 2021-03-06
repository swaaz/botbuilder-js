/**
 * @module botbuilder-dialogs-adaptive
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { ExpressionProperty } from './expressionProperty';
import { Expression } from 'adaptive-expressions';

/**
 * Represents a property which is either a boolean or a string expression which resolves to a boolean.
 * @remarks
 * String values are always interpreted as an expression, whether it has '=' prefix or not.
 */
export class BoolExpression extends ExpressionProperty<boolean> {
    public constructor(value?: boolean | string | Expression) {
        super(value, false);
    }
}