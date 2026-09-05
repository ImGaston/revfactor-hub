"""Create additive native GHL V1 schema only; never writes customer records.
Idempotent by fieldKey. Uses existing private integration from local env.
"""
from pathlib import Path
import json, urllib.request, re
BASE = 'https://services.leadconnectorhq.com'
LOCATION = 'ErABPRqWbMyIicvzvCFt'
OBJECT = 'custom_objects.revfactor_listings'
ROOT = Path(__file__).parent
source = Path('/Users/fedezimermacbookpro/Documents/RevFactor/.env.local').read_text()
key = re.search(r'^HIGHLEVEL_API_KEY=(.*)$',source,re.M).group(1).strip().strip('\"\'')
def request(path, payload=None):
    req = urllib.request.Request(BASE+path, data=json.dumps(payload).encode() if payload else None,
       headers={'Authorization':'Bearer '+key,'Version':'v3','User-Agent':'RevFactorIntegration/1.0','Content-Type':'application/json'})
    with urllib.request.urlopen(req) as result: return json.load(result)
current=request('/custom-fields/object-key/'+OBJECT+'?locationId='+LOCATION)
folder=current['folders'][0]['id']
existing={f['fieldKey']:f for f in current['fields']}
# Versioned fields preserve the earlier draft's field contract.
specs=[
('rf_v1_minimum_stay','V1 Minimum Stay','NUMERICAL','Optional firm minimum stay in whole nights, from 1 to 365. Leave blank when there is no firm limit.'),
('rf_v1_journey_id','V1 Journey ID','TEXT','Hub-issued UUID; never establishes authorization.'),
('rf_v1_property_id','V1 Property ID','TEXT','Hub-issued stable UUID; repeated edits target this property only.'),
('rf_v1_expected_revision','V1 Expected Revision','NUMERICAL','Optimistic concurrency token verified by Hub.'),
('rf_v1_submission_id','V1 Submission ID','TEXT','Idempotency ID issued for this submission.'),
('rf_v1_street','Property street address','TEXT','Property address confirmed before contract; distinct from billing address.'),
('rf_v1_unit','Property unit','TEXT','Optional property unit; part of property identity.'),
('rf_v1_city','Property city','TEXT','Property city confirmed before contract.'),
('rf_v1_region','Property state or region','TEXT','Property state or region confirmed before contract.'),
('rf_v1_postal_code','Property postal code','TEXT','Property postal code confirmed before contract.'),
('rf_v1_country','Property country','TEXT','ISO 3166-1 alpha-2 country code confirmed before contract.'),
('rf_v1_main_goal','What matters most for this property?','RADIO','Essential preference; no knowledge quiz.', [('revenue','Increase revenue'),('occupancy','Improve occupancy'),('balance','Balance revenue and occupancy'),('guidance','I need guidance')]),
('rf_v1_pricing_restrictions','Firm pricing restrictions','RADIO','Guidance does not authorize live pricing changes.', [('none','No firm restrictions'),('specified','I have firm restrictions'),('guidance','I need guidance')]),
('rf_v1_restriction_details','Your restrictions or owner-use plans','LARGE_TEXT','Only material constraints. Optional unless firm restrictions selected.'),
('rf_v1_cleaning_fee_status','Cleaning fee','RADIO','Avoid requiring invented numbers.', [('known','I know the cleaning fee'),('guidance','I need guidance')]),
('rf_v1_property_confirmation','Confirm this property','RADIO','Explicit property review; Hub validates identity and entitlement.', [('confirmed','These property details are correct'),('correction','A contracted detail needs correction')]),
]
created=[]
for spec in specs:
    fieldKey=OBJECT+'.'+spec[0]
    if fieldKey in existing: continue
    payload={'locationId':LOCATION,'name':spec[1],'dataType':spec[2],'description':spec[3], 'fieldKey':fieldKey,'objectKey':OBJECT,'parentId':folder,'showInForms':True}
    if len(spec)>4:payload['options']=[{'key':k,'label':v} for k,v in spec[4]]
    result=request('/custom-fields/',payload)['field'];created.append({'id':result['id'],'fieldKey':result['fieldKey'],'name':result['name']})
    print('Created '+result['fieldKey']+' '+result['id'])
after=request('/custom-fields/object-key/'+OBJECT+'?locationId='+LOCATION);after.pop('traceId',None)
(ROOT/'evidence/listing-fields-after.json').write_text(json.dumps(after,indent=2)+'\n')
prior_file=ROOT/'evidence/created-field-ids.json'
prior=json.loads(prior_file.read_text()) if prior_file.exists() else []
by_id={f['id']:f for f in prior+created}
prior_file.write_text(json.dumps(list(by_id.values()),indent=2)+'\n')
