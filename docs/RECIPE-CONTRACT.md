# Recipe data contract v1
Researchers each own src/data/recipes-<stream>.json and research/<stream>/* only. JSON array, each record has:
```
{
 id: string (slug), slug: string (same), title: string, description: string,
 category: 'chicken-turkey'|'meat'|'seafood'|'vegetarian'|'breakfast'|'quick-dinners'|'snacks-sides'|'desserts',
 tags: string[], sources: [{title:string,url:https URL,verifiedAt:'2026-10-11'}],
 prepMinutes:number, cookMinutes:number, totalMinutes:number (include preheat/rest), temperatureC:number,
 servings:number, portion:string,
 ingredients:[{name:string,quantity:number,unit:'g'|'ml'|'each'|'tsp'|'tbsp', preparation:string, form:string ('raw'|'cooked'|'fresh'|'dried' etc), aisle:string}],
 steps:string[], preheat:boolean, preheatMinutes:number, turn:string,
 safety:string[], internalTempC:number|null,
 nutrition:{protein:number,calories:number,carbs:number,fat:number,fibre:number|null,method:string,confidence:'estimated'|'source-estimate',reference:string},
 allergens:string[] (milk,egg,fish,crustacean,mollusc,peanut,tree-nut,sesame,soy,wheat,gluten,lupin,sulphites),
 dietary:string[] ('vegetarian','vegan','gluten-free','dairy-free' only if supported),
 substitutions:string[], oilFree:boolean, storage:string, equipment:string[], difficulty:'Easy'|'Moderate',
 image:{src:'/images/<category>.webp',alt:string,credit:'AirFuel Kitchen',licence:'AI-generated illustration; not a photograph of the tested recipe'}
}
```
Amounts are edible raw weights except explicitly labelled. Australian tablespoon 20ml and teaspoon 5ml, metric-first. Main method must air fry. Include specific arrangement, size/thickness and doneness criteria. Meat safety is thermometer-based. Nutrition must have evidence, consistent source serving convention; no manufactured precision. If scaling to 2 servings, scale ALL ingredients proportionately and macros remain PER serving. Sources must be individually opened, not guessed. Original prose, never copy instructions. Save concise source facts/provenance, not full copyrighted pages. Each stream produces a research report incl count, source verification evidence, nutrition caveats and rejected sources. Do not fabricate records to achieve quotas. No commercial source photos. Need meaningful dish differences, not spice swaps. Do not use random calculated nutrition. Publisher estimates acceptable when faithful quantities/servings, label appropriately; document nutrient method limitations. Avoid uncooked flour/egg desserts and unsupported shelf lives.
