import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { context } from './state';
import numeral from 'numeral';

import './TabWeights.css';
import * as livestock from '@aultfarms/livestock';
import { Order } from './state/state';

function truncateGroupName(str: string) {
  const parts = str.split(':');
  if (parts[0].length > 6) {
    parts[0] = parts[0]!.slice(0,3)+'...'+parts[0].slice(-3);
  }
  return parts.join(':');
}

function truncateColor(str: string) {
  if (str.length < 8) return str;
  return str.slice(0,3)+'..'+str.slice(-3);
}

export const TabWeights = observer(function TabWeights() {
  const ctx = React.useContext(context);
  const { state, actions } = ctx;

  if (!state.isInitialized) return <React.Fragment/>;

  // have to reference rev to get redraw updates
  const tagcolors = state.records.rev ? actions.records().tagcolors : {};

  let weights = state.weights.slice();
  for (const order of state.order.slice().reverse()) {
    weights = weights.sort((a,b) => {
      switch(order) {
        case 'row': return a.lineno - b.lineno;
        case 'tag':
          const c = a.tag.color.localeCompare(b.tag.color);
          if (c) return c;
          return a.tag.number - b.tag.number;
        case 'weight': return a.weight - b.weight;
        case 'group': return a.group.localeCompare(b.group);
        case 'days': return a.days - b.days;
        case 'rog': return a.rog - b.rog;
        case 'sort': return a.sort.localeCompare(b.sort);
      }
    });
  }
  const firstorder = state.order[0];
  function orderSelected(order: Order) {
    if (firstorder === order) return { background: '#DDDDFF' };
    return {};
  }
  /*
  const extrarowtagactive = state.tagInput.row === state.weights.length;
  const extrarowweightactive = state.weightInput.row === state.weights.length;
  const extrarowcolor = tagcolors[state.tagInput.tag.color] || 'BLACK';
  */
  return (
    <div className="tabweights">
      <table className="tabweightstable">
        <thead>
          <tr>
            <th style={{width: "5%", ...orderSelected('row') }} onClick={() => actions.changeOrder('row')}>#</th>
            <th style={{width: "25%", ...orderSelected('tag')}} onClick={() => actions.changeOrder('tag')}>Tag</th>
            <th style={{width: "8%", ...orderSelected('weight')}} onClick={() => actions.changeOrder('weight')}>Weight</th>
            <th style={{width: "22%", ...orderSelected('group')}} onClick={() => actions.changeOrder('group')}>Group</th>
            <th style={{width: "8%", ...orderSelected('days')}} onClick={() => actions.changeOrder('days')}>Days</th>
            <th style={{width: "8%", ...orderSelected('rog')}} onClick={() => actions.changeOrder('rog')}>RoG</th>
            <th style={{width: "24%", ...orderSelected('sort')}} onClick={() => actions.changeOrder('sort')}>Sort</th>
          </tr>
        </thead>
        <tbody>
      { weights.map((r,i) => {
        const color = tagcolors[r.tag.color] || 'BLACK';
        const tagactive = state.tagInput.row === i;
        const weightactive = state.weightInput.row === i;
        const tag = tagactive ? state.tagInput.tag : r.tag;
        return <tr key={'tabweightstablerow'+i} className='tabweightstablerow'>
          <td className='tabweightstablecol' align="center">
            { (i+1) }
          </td>
          <td className={'tabweightstablecol ' + (tagactive ? 'tagactive ' : '')}
              onClick={() => actions.moveTagInput(i)}
              id={tagactive ? 'tagScrollToMe' : 'tagDoNotScrollToMe' }>
            <div className="tabweightstagtext" style={{ color, borderColor: color }}>
              {truncateColor(tag.color)} {tag.number || ''}
            </div>
          </td>
          <td className={'tabweightstablecol ' + (weightactive ? 'weightactive' : '') }
              onClick={() => actions.moveWeightInput(i)}
              id={weightactive ? 'weightScrollToMe' : 'weightDoNotScrollToMe' }
              align="center">
            { weightactive ? state.weightInput.weight : r.weight }
          </td>
          <td className='tabweightstablecol' align="center">
            { truncateGroupName(r.group) || '' }
          </td>
          <td className='tabweightstablecol' align="center">
            { r.days || '' }
          </td>
          <td className='tabweightstablecol' align="center">
            { r.rog ? numeral(r.rog).format('0.00') : '' }
          </td>
          <td className='tabweightstablecol' align="center">
            <select
              onChange={(evt) => actions.changeSort(i, evt.target.value)}
              value={ r.sort || 'SELL' }
            >
              {livestock.weights.sorts.map(s => <option key={'sortoption'+s} value={s}>{s}</option>)}
            </select>
          </td>

        </tr>})
      }
        { /* You need this extra row for scrolling because the action doesn't get the view redraw
             triggered before needing to scroll to the new row.
          */
        }
        <tr key="extrarow" style={{ height: '3em', border: 'none' }} id="extraRowScrollToMe"><td> </td></tr>
      </tbody>
      </table>
    </div>
  );
});