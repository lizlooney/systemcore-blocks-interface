/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @author lizlooney@google.com (Liz Looney)
 */

import * as Blockly from 'blockly/core';
import * as toolboxItems from './items';
import { FunctionData } from '../blocks/utils/python_json_types';
import { addBuiltInFunctionBlocks } from '../blocks/mrc_call_python_function';

export function getCategory(): toolboxItems.Category {
  const contents: toolboxItems.ContentsType[] = [];

  const 

  const colorFunctions: FunctionData[] = [];

  const printFunction: FunctionData = {
    functionName: 'hls_to_rgb',
    tooltip: 'Print the given message',
    returnType: 'None',
    args: [{
      name: '',
      type: 'str',
      defaultValue: '""',
    }],
  };

  return {
    kind: 'category',
    name: Blockly.Msg['MRC_CATEGORY_COLOR'],
    contents,
  };
}
