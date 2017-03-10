/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as assert from 'assert';
import { Platform } from 'vs/base/common/platform';
import { TerminalLinkHandler } from 'vs/workbench/parts/terminal/electron-browser/terminalLinkHandler';

class TestTerminalLinkHandler extends TerminalLinkHandler {
	public get localLinkRegex(): RegExp {
		return this._localLinkRegex;
	}
}

suite('Workbench - TerminalLinkHandler', () => {
	suite('localLinkRegex', () => {
		test('Windows', () => {
			const regex = new TestTerminalLinkHandler(Platform.Windows, null, null).localLinkRegex;
			function testLink(link: string) {
				assert.equal(` ${link} `.match(regex)[1], link);
				assert.equal(`:${link}:`.match(regex)[1], link);
				assert.equal(`;${link};`.match(regex)[1], link);
				assert.equal(`(${link})`.match(regex)[1], link);
			}
			testLink('c:\\foo');
			testLink('c:/foo');
			testLink('.\\foo');
			testLink('./foo');
			testLink('..\\foo');
			testLink('../foo');
			testLink('~\\foo');
			testLink('~/foo');
			testLink('c:/a/long/path');
			testLink('c:\\a\\long\\path');
			testLink('c:\\mixed/slash\\path');
		});

		test('Linux', () => {
			const regex = new TestTerminalLinkHandler(Platform.Linux, null, null).localLinkRegex;
			function testLink(link: string) {
				assert.equal(` ${link} `.match(regex)[1], link);
				assert.equal(`:${link}:`.match(regex)[1], link);
				assert.equal(`;${link};`.match(regex)[1], link);
				assert.equal(`(${link})`.match(regex)[1], link);
			}
			testLink('/foo');
			testLink('~/foo');
			testLink('./foo');
			testLink('../foo');
			testLink('/a/long/path');
		});
	});
});