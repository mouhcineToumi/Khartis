import Ember from 'ember';


export default Ember.Controller.extend({
  
    store: Ember.inject.service(),
  
    actions: {
      
      onAskVersioning(type) {
        switch (type) {
          case "undo":
            this.get('store').versions().undo();
            break;
          case "redo": 
            this.get('store').versions().redo();
            break;
          case "freeze": 
            this.get('store').versions().freeze(this.get('model').export());
            break;
        }
        
      }
    
    }
  
});
