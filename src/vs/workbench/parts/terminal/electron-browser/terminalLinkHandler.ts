/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as pfs from 'vs/base/node/pfs';
import Uri from 'vs/base/common/uri';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { Platform } from 'vs/base/common/platform';
import { TPromise } from 'vs/base/common/winjs.base';

const pathPrefix = '(\\.\\.?|\\~)';
const pathSeparatorClause = '\\/';
const excludedPathCharactersClause = '[^\\0\\s!$`&*()\\[\\]+\'":;]'; // '":; are allowed in paths but they are often separators so ignore them
const escapedExcludedPathCharactersClause = '(\\\\s|\\\\!|\\\\$|\\\\`|\\\\&|\\\\*|(|)|\\+)';
/** A regex that matches paths in the form /path, ~/path, ./path, ../path */
const UNIX_LIKE_LOCAL_LINK_REGEX = new RegExp('(' + pathPrefix + '?(' + pathSeparatorClause + '(' + excludedPathCharactersClause + '|' + escapedExcludedPathCharactersClause + ')+)+)');

const winPathPrefix = '([a-zA-Z]:|\\.\\.?|\\~)';
const winPathSeparatorClause = '(\\\\|\\/)';
const winExcludedPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!$`&*()\\[\\]+\'":;]';
/** A regex that matches paths in the form c:\path, ~\path, .\path */
const WINDOWS_LOCAL_LINK_REGEX = new RegExp('(' + winPathPrefix + '?(' + winPathSeparatorClause + '(' + winExcludedPathCharactersClause + ')+)+)');

/** Higher than local link, lower than hypertext */
const CUSTOM_LINK_PRIORITY = -1;
/** Lowest */
const LOCAL_LINK_PRIORITY = -2;

export type XtermLinkMatcherHandler = (event: MouseEvent, uri: string) => boolean | void;
export type XtermLinkMatcherValidationCallback = (uri: string, callback: (isValid: boolean) => void) => void;

export class TerminalLinkHandler {
	constructor(
		private _platform: Platform,
		@IWorkbenchEditorService private _editorService: IWorkbenchEditorService,
		@IWorkspaceContextService private _contextService: IWorkspaceContextService
	) {
	}

	public initialize(xterm: any) {
		xterm.attachHypertextLinkHandler(this._wrapLinkHandler(() => true));
	}

	public registerCustomLinkHandler(xterm: any, regex: RegExp, handler: (uri: string) => void, matchIndex?: number, validationCallback?: XtermLinkMatcherValidationCallback): number {
		return xterm.registerLinkMatcher(regex, this._wrapLinkHandler(handler), {
			matchIndex,
			validationCallback,
			priority: CUSTOM_LINK_PRIORITY
		});
	}

	public registerLocalLinkHandler(xterm: any): number {
		const wrappedHandler = this._wrapLinkHandler(url => {
			this._handleLocalLink(url);
			return;
		});
		return xterm.registerLinkMatcher(this._localLinkRegex, wrappedHandler, {
			matchIndex: 1,
			validationCallback: (link: string, callback: (isValid: boolean) => void) => this._validateLocalLink(link, callback),
			priority: LOCAL_LINK_PRIORITY
		});
	}

	private _wrapLinkHandler(handler: (uri: string) => boolean | void): XtermLinkMatcherHandler {
		return (event: MouseEvent, uri: string) => {
			// Require ctrl/cmd on click
			if (this._platform === Platform.Mac ? !event.metaKey : !event.ctrlKey) {
				// TODO: Show hint on fail
				event.preventDefault();
				return false;
			}
			return handler(uri);
		};
	}

	protected get _localLinkRegex(): RegExp {
		if (this._platform === Platform.Windows) {
			return WINDOWS_LOCAL_LINK_REGEX;
		}
		return UNIX_LIKE_LOCAL_LINK_REGEX;
	}

	private _handleLocalLink(link: string): TPromise<void> {
		return this._resolvePath(link).then(resolvedLink => {
			if (!resolvedLink) {
				return void 0;
			}
			const resource = Uri.file(path.normalize(path.resolve(resolvedLink)));
			return this._editorService.openEditor({ resource }).then(() => void 0);
		});
	}

	private _validateLocalLink(link: string, callback: (isValid: boolean) => void): void {
		this._resolvePath(link).then(resolvedLink => {
			callback(!!resolvedLink);
		});
	}

	private _resolvePath(link: string): TPromise<string> {
		if (this._platform === Platform.Windows) {
			// Resolve ~ -> %HOMEDRIVE%\%HOMEPATH%
			if (link.charAt(0) === '~') {
				if (!process.env.HOMEDRIVE || !process.env.HOMEPATH) {
					return TPromise.as(void 0);
				}
				link = `${process.env.HOMEDRIVE}\\${process.env.HOMEPATH + link.substring(1)}`;
			}
		} else {
			// Resolve workspace path . / .. -> <path>/. / <path/..
			if (link.charAt(0) === '.') {
				if (!this._contextService.hasWorkspace) {
					// Abort if no workspace is open
					return TPromise.as(void 0);
				}
				link = path.join(this._contextService.getWorkspace().resource.fsPath, link);
			}
		}
		// Resolve workspace path . / .. -> <path>/. / <path/..
		if (link.charAt(0) === '.') {
			if (!this._contextService.hasWorkspace) {
				// Abort if no workspace is open
				return TPromise.as(void 0);
			}
			link = path.join(this._contextService.getWorkspace().resource.fsPath, link);
		}

		// Open an editor if the path exists
		return pfs.fileExists(link).then(isFile => {
			if (!isFile) {
				return null;
			}
			return link;
		});
	}
}
