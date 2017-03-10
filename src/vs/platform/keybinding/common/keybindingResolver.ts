/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { createKeybinding, SimpleKeybinding, Keybinding } from 'vs/base/common/keyCodes';
import { ISimplifiedPlatform, KeybindingLabels } from 'vs/platform/keybinding/common/keybindingLabels';
import * as platform from 'vs/base/common/platform';
import { IKeybindingItem, IUserFriendlyKeybinding } from 'vs/platform/keybinding/common/keybinding';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { CharCode } from "vs/base/common/charCode";

export interface IResolveResult {
	enterChord: SimpleKeybinding;
	commandId: string;
	commandArgs: any;
	bubble: boolean;
}

export interface IBoundCommands {
	[commandId: string]: boolean;
}

interface ICommandMap {
	[partialKeybinding: number]: NormalizedKeybindingItem[];
}

interface IChordsMap {
	[partialKeybinding: number]: ICommandMap;
}

export class NormalizedKeybindingItem {
	_normalizedKeybindingItemBrand: void;

	public readonly keybinding: Keybinding;
	public readonly bubble: boolean;
	public readonly command: string;
	public readonly commandArgs: any;
	public readonly when: ContextKeyExpr;
	public readonly isDefault: boolean;

	public static fromKeybindingItem(source: IKeybindingItem, isDefault: boolean): NormalizedKeybindingItem {
		let when: ContextKeyExpr = null;
		if (source.when) {
			when = source.when.normalize();
		}
		let keybinding: Keybinding = null;
		if (source.keybinding !== 0) {
			keybinding = createKeybinding(source.keybinding);
		}
		return new NormalizedKeybindingItem(keybinding, source.command, source.commandArgs, when, isDefault);
	}

	constructor(keybinding: Keybinding, command: string, commandArgs: any, when: ContextKeyExpr, isDefault: boolean) {
		this.keybinding = keybinding;
		this.bubble = (command ? command.charCodeAt(0) === CharCode.Caret : false);
		this.command = this.bubble ? command.substr(1) : command;
		this.commandArgs = commandArgs;
		this.when = when;
		this.isDefault = isDefault;
	}
}

export class KeybindingResolver {
	private readonly _defaultKeybindings: NormalizedKeybindingItem[];
	private readonly _shouldWarnOnConflict: boolean;
	private readonly _defaultBoundCommands: IBoundCommands;
	private readonly _map: ICommandMap;
	private readonly _chords: IChordsMap;
	private readonly _lookupMap: Map<string, NormalizedKeybindingItem[]>;

	constructor(defaultKeybindings: NormalizedKeybindingItem[], overrides: NormalizedKeybindingItem[], shouldWarnOnConflict: boolean = true) {
		this._defaultKeybindings = defaultKeybindings;
		this._shouldWarnOnConflict = shouldWarnOnConflict;

		this._defaultBoundCommands = Object.create(null);
		for (let i = 0, len = defaultKeybindings.length; i < len; i++) {
			this._defaultBoundCommands[defaultKeybindings[i].command] = true;
		}

		this._map = Object.create(null);
		this._chords = Object.create(null);
		this._lookupMap = new Map<string, NormalizedKeybindingItem[]>();

		let allKeybindings = KeybindingResolver.combine(defaultKeybindings, overrides);
		for (let i = 0, len = allKeybindings.length; i < len; i++) {
			let k = allKeybindings[i];
			if (k.keybinding === null) {
				continue;
			}

			if (k.keybinding.isChord()) {
				// This is a chord
				let keybindingFirstPart = k.keybinding.extractFirstPart().value;
				let keybindingChordPart = k.keybinding.extractChordPart().value;

				this._chords[keybindingFirstPart] = this._chords[keybindingFirstPart] || Object.create(null);
				this._chords[keybindingFirstPart][keybindingChordPart] = this._chords[keybindingFirstPart][keybindingChordPart] || [];
				this._chords[keybindingFirstPart][keybindingChordPart].push(k);

				this._addKeyPress(keybindingFirstPart, k);

			} else {
				this._addKeyPress(k.keybinding.value, k);

			}
		}
	}

	private static _isTargetedForRemoval(defaultKb: NormalizedKeybindingItem, keybinding: Keybinding, command: string, when: ContextKeyExpr): boolean {
		if (defaultKb.command !== command) {
			return false;
		}
		if (keybinding && !keybinding.equals(defaultKb.keybinding)) {
			return false;
		}
		if (when) {
			if (!defaultKb.when) {
				return false;
			}
			if (!when.equals(defaultKb.when)) {
				return false;
			}
		}
		return true;

	}

	/**
	 * Looks for rules containing -command in `overrides` and removes them directly from `defaults`.
	 */
	public static combine(defaults: NormalizedKeybindingItem[], rawOverrides: NormalizedKeybindingItem[]): NormalizedKeybindingItem[] {
		defaults = defaults.slice(0);
		let overrides: NormalizedKeybindingItem[] = [];
		for (let i = 0, len = rawOverrides.length; i < len; i++) {
			let override = rawOverrides[i];
			if (!override.command || override.command.length === 0 || override.command.charAt(0) !== '-') {
				overrides.push(override);
				continue;
			}

			let commandToRemove = override.command.substr(1);
			let keybindingToRemove = override.keybinding;
			let whenToRemove = override.when;
			for (let j = defaults.length - 1; j >= 0; j--) {
				if (this._isTargetedForRemoval(defaults[j], keybindingToRemove, commandToRemove, whenToRemove)) {
					defaults.splice(j, 1);
				}
			}
		}
		return defaults.concat(overrides);
	}

	private _addKeyPress(keypress: number, item: NormalizedKeybindingItem): void {

		if (!this._map[keypress]) {
			// There is no conflict so far
			this._map[keypress] = [item];
			this._addToLookupMap(item);
			return;
		}

		let conflicts = this._map[keypress];

		for (let i = conflicts.length - 1; i >= 0; i--) {
			let conflict = conflicts[i];

			if (conflict.command === item.command) {
				continue;
			}

			if (conflict.keybinding.isChord() && item.keybinding.isChord() && conflict.keybinding.value !== item.keybinding.value) {
				// The conflict only shares the chord start with this command
				continue;
			}

			if (KeybindingResolver.whenIsEntirelyIncluded(true, conflict.when, item.when)) {
				// `item` completely overwrites `conflict`
				if (this._shouldWarnOnConflict && item.isDefault) {
					console.warn('Conflict detected, command `' + conflict.command + '` cannot be triggered by ' + KeybindingLabels.toUserSettingsLabel(conflict.keybinding) + ' due to ' + item.command);
				}

				// Remove conflict from the lookupMap
				this._removeFromLookupMap(conflict);
			}
		}

		conflicts.push(item);
		this._addToLookupMap(item);
	}

	private _addToLookupMap(item: NormalizedKeybindingItem): void {
		if (!item.command) {
			return;
		}

		let arr = this._lookupMap.get(item.command);
		if (typeof arr === 'undefined') {
			arr = [item];
			this._lookupMap.set(item.command, arr);
		} else {
			arr.push(item);
		}
	}

	private _removeFromLookupMap(item: NormalizedKeybindingItem): void {
		let arr = this._lookupMap.get(item.command);
		if (typeof arr === 'undefined') {
			return;
		}
		for (let i = 0, len = arr.length; i < len; i++) {
			if (arr[i] === item) {
				arr.splice(i, 1);
				return;
			}
		}
	}

	/**
	 * Returns true if `a` is completely covered by `b`.
	 * Returns true if `b` is a more relaxed `a`.
	 * Return true if (`a` === true implies `b` === true).
	 */
	public static whenIsEntirelyIncluded(inNormalizedForm: boolean, a: ContextKeyExpr, b: ContextKeyExpr): boolean {
		if (!inNormalizedForm) {
			a = a ? a.normalize() : null;
			b = b ? b.normalize() : null;
		}
		if (!b) {
			return true;
		}
		if (!a) {
			return false;
		}

		let aRulesArr = a.serialize().split(' && ');
		let bRulesArr = b.serialize().split(' && ');

		let aRules: { [rule: string]: boolean; } = Object.create(null);
		for (let i = 0, len = aRulesArr.length; i < len; i++) {
			aRules[aRulesArr[i]] = true;
		}

		for (let i = 0, len = bRulesArr.length; i < len; i++) {
			if (!aRules[bRulesArr[i]]) {
				return false;
			}
		}

		return true;
	}

	public getDefaultBoundCommands(): IBoundCommands {
		return this._defaultBoundCommands;
	}

	public getDefaultKeybindings(): string {
		let out = new OutputBuilder();
		out.writeLine('[');

		let lastIndex = this._defaultKeybindings.length - 1;
		this._defaultKeybindings.forEach((k, index) => {
			IOSupport.writeKeybindingItem(out, k);
			if (index !== lastIndex) {
				out.writeLine(',');
			} else {
				out.writeLine();
			}
		});
		out.writeLine(']');
		return out.toString();
	}

	public lookupKeybindings(commandId: string): NormalizedKeybindingItem[] {
		let items = this._lookupMap.get(commandId);
		if (typeof items === 'undefined' || items.length === 0) {
			return [];
		}

		// Reverse to get the most specific item first
		let result: NormalizedKeybindingItem[] = [], resultLen = 0;
		for (let i = items.length - 1; i >= 0; i--) {
			result[resultLen++] = items[i];
		}
		return result;
	}

	public lookupPrimaryKeybinding(commandId: string): NormalizedKeybindingItem {
		let items = this._lookupMap.get(commandId);
		if (typeof items === 'undefined' || items.length === 0) {
			return null;
		}

		return items[items.length - 1];
	}

	public resolve(context: any, currentChord: SimpleKeybinding, keypress: SimpleKeybinding): IResolveResult {
		// console.log('resolve: ' + Keybinding.toUserSettingsLabel(keypress));
		let lookupMap: NormalizedKeybindingItem[] = null;

		if (currentChord !== null) {
			let chords = this._chords[currentChord.value];
			if (!chords) {
				return null;
			}
			lookupMap = chords[keypress.value];
		} else {
			lookupMap = this._map[keypress.value];
		}

		let result = this._findCommand(context, lookupMap);
		if (!result) {
			return null;
		}

		if (currentChord === null && result.keybinding.isChord()) {
			return {
				enterChord: keypress,
				commandId: null,
				commandArgs: null,
				bubble: false
			};
		}

		return {
			enterChord: null,
			commandId: result.command,
			commandArgs: result.commandArgs,
			bubble: result.bubble
		};
	}

	private _findCommand(context: any, matches: NormalizedKeybindingItem[]): NormalizedKeybindingItem {
		if (!matches) {
			return null;
		}

		for (let i = matches.length - 1; i >= 0; i--) {
			let k = matches[i];

			if (!KeybindingResolver.contextMatchesRules(context, k.when)) {
				continue;
			}

			return k;
		}

		return null;
	}

	public static contextMatchesRules(context: any, rules: ContextKeyExpr): boolean {
		if (!rules) {
			return true;
		}
		return rules.evaluate(context);
	}
}

function rightPaddedString(str: string, minChars: number): string {
	if (str.length < minChars) {
		return str + (new Array(minChars - str.length).join(' '));
	}
	return str;
}

export class OutputBuilder {

	private _lines: string[] = [];
	private _currentLine: string = '';

	write(str: string): void {
		this._currentLine += str;
	}

	writeLine(str: string = ''): void {
		this._lines.push(this._currentLine + str);
		this._currentLine = '';
	}

	toString(): string {
		this.writeLine();
		return this._lines.join('\n');
	}
}

export class IOSupport {

	public static writeKeybindingItem(out: OutputBuilder, item: NormalizedKeybindingItem): void {
		let quotedSerializedKeybinding = JSON.stringify(IOSupport.writeKeybinding(item.keybinding));
		out.write(`{ "key": ${rightPaddedString(quotedSerializedKeybinding + ',', 25)} "command": `);

		let serializedWhen = item.when ? item.when.serialize() : '';
		let quotedSerializeCommand = JSON.stringify(item.command);
		if (serializedWhen.length > 0) {
			out.write(`${quotedSerializeCommand},`);
			out.writeLine();
			out.write(`                                     "when": "${serializedWhen}" `);
		} else {
			out.write(`${quotedSerializeCommand} `);
		}
		// out.write(String(item.weight1 + '-' + item.weight2));
		out.write('}');
	}

	public static readKeybindingItem(input: IUserFriendlyKeybinding, index: number): IKeybindingItem {
		let key: number = 0;
		if (typeof input.key === 'string') {
			key = IOSupport.readKeybinding(input.key);
		}

		let when: ContextKeyExpr = null;
		if (typeof input.when === 'string') {
			when = ContextKeyExpr.deserialize(input.when);
		}

		let command: string = null;
		if (typeof input.command === 'string') {
			command = input.command;
		}

		let commandArgs: any = null;
		if (typeof input.args !== 'undefined') {
			commandArgs = input.args;
		}

		return {
			keybinding: key,
			command: command,
			commandArgs: commandArgs,
			when: when,
			weight1: 1000,
			weight2: index
		};
	}

	public static writeKeybinding(keybinding: Keybinding, Platform: ISimplifiedPlatform = platform): string {
		return KeybindingLabels.toUserSettingsLabel(keybinding, Platform);
	}

	public static readKeybinding(input: string, Platform: ISimplifiedPlatform = platform): number {
		return KeybindingLabels.fromUserSettingsLabel(input, Platform);
	}
}
