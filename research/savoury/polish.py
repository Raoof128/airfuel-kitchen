import json,pathlib
R=pathlib.Path(__file__).parent;p=R/'authored.json';a=json.loads(p.read_text())
desc='''air-fryer-beef-joint|A mustard and thyme crust surrounds a roast to carve into thin slices.
air-fryer-cheese-ham-toastie|Buttered sourdough crisps around melted cheddar, ham and a little mustard.
air-fryer-chicken-breasts|A paprika and herb coating gives plain chicken breasts a savoury crust for lunches or dinner.
air-fryer-chicken-nuggets|Bite-size chicken pieces get a crisp panko shell without added oil.
air-fryer-chicken-parmigiana|Crumbed chicken cutlets are finished with tomato sauce and bubbling mozzarella.
air-fryer-chicken-thighs|Bone-in thighs cook skin-side down first, then turn for a crisp finish.
air-fryer-chicken-tikka-kebabs|Yoghurt-marinated chicken fills warm naan with garlic, ginger and fresh coriander.
air-fryer-crispy-chilli-beef|Crisp steak strips meet a tangy chilli sauce, capsicum and spring onions.
air-fryer-fish-tacos|Spiced fish, avocado and lime-dressed cabbage fill soft tortillas.
air-fryer-garlic-oregano-lamb-leg-with-crispy-new-potatoes|Garlic-studded lamb roasts alongside potatoes finished with parmesan and lemon.
air-fryer-ham-cheese-egg-bagel|An egg sets in the centre of a toasted bagel layered with ham, cheddar and chilli jam.
air-fryer-hunters-chicken|Bacon wraps chicken breasts before a barbecue sauce and cheddar topping.
air-fryer-lamb-chops|Garlic and rosemary season small lamb chops with browned edges.
air-fryer-loaded-frittata-with-bacon-cheddar|A soft egg-and-breadcrumb bake is topped with crisp bacon and melted cheddar.
air-fryer-meatballs|Beef, pork and parmesan combine in small meatballs that work as snacks or meal components.
air-fryer-pork-apple-sage-sausage-rolls|Flaky pastry encloses pork sausagemeat sweetened with apple and fresh sage.
air-fryer-pork-belly|A hot start crisps the pork skin before gentler cooking finishes the meat.
air-fryer-pork-chops|Parmesan, mustard and herbs form a savoury coating on pork chops.
air-fryer-pork-joint|A two-temperature roast develops crackling on a boneless pork shoulder.
air-fryer-salmon|Small salmon fillets cook quickly under a simple garlic and mixed-herb coating.
air-fryer-salt-pepper-chicken|Chicken, capsicum and pak choi cook in stages with Sichuan pepper and five-spice.
air-fryer-soy-cranberry-chicken-wings|Cranberry sauce and soy make a sticky, sweet-savoury wing glaze.
air-fryer-steak|Thick rib-eye steaks get a quick hot cook followed by a short rest.
air-fryer-sticky-pork-tacos-with-plum-chilli-salsa|Crisp pork belly meets a fresh plum, chilli and lime salsa in small tortillas.
air-fryer-tuna-pasta-bake|Tuna, tomato and pasta bake under a golden mozzarella topping.
air-fryer-turkey-crown|Clementine, shallot and herbs flavour a small turkey crown for carving.
apricot-orange-horseradish-air-fryer-chicken-thighs-with-rainbow-confetti-salad|Apricot-glazed chicken sits beside a crunchy carrot, radish, pecan and pomegranate salad.
charred-harissa-chicken-salad-with-cranberries-apple-herby-yogurt-dressing|Harissa chicken tops leafy greens with apple, walnuts, feta and herb yoghurt dressing.
panko-pesto-fish|Pesto and parmesan crumbs top hoki served with wedges, peas and caper mayonnaise.
air-fryer-steak-fajitas|Steak strips join roast capsicum and onion in a filling for your choice of sides.
air-fryer-chicken-fajitas|Chicken strips, capsicum and red onion form a simple spiced fajita filling.
air-fryer-chicken-drumsticks|A light oil and herb coating browns chicken drumsticks while the meat cooks through.
air-fryer-corned-beef-hash|Small potato and carrot cubes cook before canned corned beef adds crisp savoury edges.
lemon-rosemary-chicken-potatoes-in-the-air-fryer|A whole lemon-and-oregano chicken roasts with potato wedges tucked around it.
air-fryer-steak-bites-and-potatoes|Potato cubes get a head start before sirloin bites join the basket.
air-fryer-pork-steak|Lean pork leg steaks need only garlic and pepper before a quick air-fry.
air-fryer-meatball-potato-traybake|Cheese-flecked beef meatballs cook with potato, swede, carrot and capsicum.
air-fryer-leftover-turkey-pot-pie|Cooked turkey, peas and carrots sit in a creamy filling beneath puff-pastry lids.
bottom-of-the-fridge-leftover-turkey-muffins-in-the-air-fryer|Egg cups turn cooked turkey, carrot and corn into individual savoury bakes.
homemade-air-fryer-fishcakes|Salmon and hoki combine with mashed potato in crumb-coated fishcakes.
air-fryer-filet-o-fish|Crumbed hoki, cheese and a lemon-dill sauce fill soft bread rolls.
cod-in-air-fryer|Hoki fillets cook with cherry tomatoes and herbs, with no added oil.
air-fryer-whole-fish|A deboned butterflied bream holds lemon, garlic and fresh herbs inside its skin.
air-fryer-tuna-steak|Tuna steaks cook beside basil-coated cherry tomatoes for a simple fish meal.
air-fryer-bacon-wrapped-scallops|Thin bacon strips wrap scallops before a short cook in a single layer.
air-fryer-chicken-burrito-bowl|Chicken, beans, corn and avocado make generous bowls with cheese, salsa and yoghurt.
air-fryer-lamb-steaks|A mint, honey and lemon marinade seasons lamb steaks before cooking.
chicken-pot-pie-in-air-fryer|Freshly air-fried chicken becomes a creamy corn filling under individual pastry lids.
air-fryer-pork-apple-burgers|Grated apple and cheddar keep pork patties tender beside a batch of chips.
air-fryer-turkey-meatballs|Lean turkey, parsley and a little breadcrumb form four-meatball portions.
air-fryer-turkey-legs|Large herb-coated drumsticks roast before the meat is carved into portions.
air-fryer-boneless-turkey-breast|A balsamic and herb rub seasons a boneless turkey roast finished in thick slices.
air-fryer-turkey-burgers|Turkey breast patties, melted cheddar and potato cubes make a complete burger meal.
air-fryer-corned-beef-pasty|Corned beef, potato and cheddar fill crisp, sealed pastry parcels.
kfc-unbreaded-chicken-tenders-in-air-fryer|An egg and spice coating seasons chicken strips without flour or breadcrumbs.
breaded-air-fryer-pork-chops|A brief apple marinade precedes a crisp herb-crumb coating on lean pork.
air-fryer-pork-ribs|Small pork ribs are brushed with a honey, soy and barbecue glaze.
air-fryer-balsamic-chicken-vegetables|Chicken pieces roast with zucchini, capsicum and tomatoes in a balsamic-honey coating.
air-fryer-cajun-shrimp|Cajun-coated prawns finish with fresh lemon after a quick cook from frozen.
air-fryer-lamb-kofta-kebabs|Lamb mince and warm spices form small kofta fingers without added oil.
air-fryer-shrimp-fajitas|Cooked frozen prawns heat with sliced capsicum, onion and fajita seasoning.
air-fryer-meatloaf|A small lean-beef loaf finishes under a tomato and Worcestershire glaze.
air-fryer-chicken-cordon-bleu|Chicken breasts enclose ham and cheddar beneath a crisp breadcrumb coating.
air-fryer-pork-loin|A herb and spice rub seasons a whole pork loin without added oil.
flourless-truly-crispy-calamari-rings-in-the-air-fryer|Pita crumbs, lemon and herbs coat calamari rings for a crisp finish.
air-fryer-tandoori-chicken-kebabs|An overnight yoghurt marinade brings ginger, garlic and warm spices to chicken pieces.
nandos-peri-peri-chicken-bowl-in-the-air-fryer|Peri-peri chicken and sweetcorn are portioned over cooked brown rice.
air-fryer-tuna-melt|Tuna, sweetcorn and red onion fill bread rolls under melted cheddar.
air-fryer-chicken-taquitos|Small corn tortillas roll around a chicken, salsa and cheese filling.
air-fryer-shrimp-scampi|Prawns cook in a shallow pan of garlic butter, white wine and lemon.
air-fryer-rack-of-lamb|A mustard-rosemary coating flavours a small lamb rack before carving.
air-fryer-lamb-ribs|Small lamb riblets cook with a honey-soy glaze and a little cumin.
air-fryer-fishcakes|Salmon, red curry paste and green beans form small Thai-style cakes with chilli mayo.
air-fryer-pork-in-blanket-turnovers|Bacon-wrapped cocktail sausages sit in pastry with chutney and cheddar.
air-fryer-roast-dinner|Chicken breasts, potatoes, carrots and peas cook in stages for a compact roast dinner.
air-fryer-fish-chips|Cornflour-coated white fish cooks after chunky chips in a single basket.
air-fryer-sesame-prawn-toast|A fresh prawn and ginger topping cooks on toasted bread under sesame seeds.
air-fryer-pork-potato-kofte|Grated potato lightens pork kofte served with bulgur salad and hummus.
air-fryer-sticky-chicken-with-crispy-potatoes|Honey-soy chicken thighs finish beside parboiled potato cubes with crisp edges.
air-fryer-smash-burgers-with-cheese-bacon|Thin beef patties are layered with bacon, cheddar, salad and measured sauces.
air-fryer-scotch-eggs|Sage-and-bacon sausagemeat encloses whole eggs beneath golden panko crumbs.
air-fryer-harissa-sausage-veg-traybake|Sausages roast with pumpkin, capsicum and kale in a lemon-harissa coating.
air-fryer-cheese-chorizo-quesadillas|Folded tortillas enclose cheddar, chorizo, tomatoes and spring onion.
air-fryer-mediterranean-style-chicken-bowl|Yoghurt-coated chicken and roast onions meet giant couscous and a cucumber-dill salad.
air-fryer-kung-pao-style-peanut-prawns|Prawns and capsicum are tossed with a glossy sauce and peanuts, then served with rice.
air-fryer-buffalo-wings|Crisp wings take a buttery hot-sauce glaze with yoghurt ranch alongside.
air-fryer-gyros|Marinated chicken, fresh tzatziki and hand-cut chips fill warm pita breads.
sticky-air-fryer-salmon-rice-bowl|Sticky salmon cubes share a bowl with edamame, cucumber, radish and nori; rice is extra.
air-fryer-keema-samosas|Thin homemade pastry encloses spiced beef, potato and peas before air-frying.
air-fryer-spiced-shrimp-po-boys-with-celeriac-remoulade|Crumbed prawns and tangy celeriac remoulade fill soft rolls with lettuce and gherkins.'''
for row in desc.splitlines():
 slug,d=row.split('|',1);a[slug]['description']=d
for slug,r in a.items():
 r['title']=r['title'].replace('courgette','zucchini').replace('squash','pumpkin')
 if 'turn' not in r:
  steps=' '.join(r['steps']).lower()
  r['turn']='Follow the turning points in the steps; turn before adding cheese or other loose toppings.' if 'turn' in steps else 'Keep upright; stir or shake only where the cooking steps specify.'
 if any(t in slug for t in ['joint','crown','whole-fish','rack-of-lamb','pork-loin','lemon-rosemary','lamb-leg','boneless-turkey-breast','pork-belly']):
  r.setdefault('safety',[]).append('Changing servings does not scale the cooking time for a whole joint, bird or fish. Choose a piece that fits your appliance, then use the thermometer target and allow extra time or batches.')
 r.setdefault('safety',[]).append('Check packaged ingredients for allergens and cross-contact warnings; substitutions can change the allergen list.')
 if 'milk' not in r.get('allergens',[]):r['dietary']=['dairy-free']
p.write_text(json.dumps(a,indent=2,ensure_ascii=False))
print('Updated descriptions:',len(desc.splitlines()))
