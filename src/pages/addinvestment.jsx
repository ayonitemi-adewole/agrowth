import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { toast } from 'react-toastify';
import { db } from '../firebase';
import { Button, Card, Input, PageHeader, Select, Textarea } from '../components/ui';

const AddInvestmentProduct = () => {
  const [formData, setFormData] = useState({
    name: 'Peppers',
    category: 'Vegetables Farming',
    expectedROI: 22,
    investmentPeriod: 3,
    minimumInvestment: 6500,
    availableUnits: 130,
    unitPrice: 500,
    riskLevel: 'Medium',
    description: 'Pepper farming with moderate risk and steady returns.',
    startDate: '2025-06-15',
    endDate: '2025-09-15',
    status: 'Open',
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'investmentProducts', formData.name.toLowerCase()), {
        ...formData,
        expectedROI: Number(formData.expectedROI),
        investmentPeriod: Number(formData.investmentPeriod),
        minimumInvestment: Number(formData.minimumInvestment),
        availableUnits: Number(formData.availableUnits),
        unitPrice: Number(formData.unitPrice),
        startDate: new Date(formData.startDate).toISOString(),
        endDate: new Date(formData.endDate).toISOString(),
      });
      toast.success('Investment product added successfully!');
    } catch (error) {
      toast.error(`Error adding product: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const field = (name, label, type = 'text') => <Input name={name} label={label} type={type} value={formData[name]} onChange={handleChange} required />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader title="Add investment product" subtitle="Admin tool" back />
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          {field('name', 'Product name')}
          {field('category', 'Category')}
          {field('expectedROI', 'Expected ROI (%)', 'number')}
          {field('investmentPeriod', 'Period (months)', 'number')}
          {field('minimumInvestment', 'Minimum investment (₦)', 'number')}
          {field('unitPrice', 'Unit price (₦)', 'number')}
          {field('availableUnits', 'Available units', 'number')}
          <Select name="riskLevel" label="Risk level" value={formData.riskLevel} onChange={handleChange}>
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </Select>
          {field('startDate', 'Start date', 'date')}
          {field('endDate', 'End date', 'date')}
          <Textarea name="description" label="Description" value={formData.description} onChange={handleChange} required fieldClassName="sm:col-span-2" />
          <Button type="submit" loading={saving} className="sm:col-span-2">
            Add product
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default AddInvestmentProduct;
