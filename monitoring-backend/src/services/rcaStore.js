export const rcaEvents = [];

export function storeRCAEvent(event){

  rcaEvents.push({
    time:new Date(),
    cause:event.smartCause,
    action:event.smartAction,
    health:event.healthScore
  });

  if(rcaEvents.length>5000)
    rcaEvents.shift();
}